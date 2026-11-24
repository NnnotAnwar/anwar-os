import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { opsAlertKinds, opsAlertSettings, opsAlertState, type OpsAlertKind } from "@/db/schema"
import { agentRequest } from "./agent"
import { loadServerStatus } from "./host"
import { evaluateAlerts, type Alert, type AlertInput } from "./lib/server"
import type { AgentService } from "./schema"

// Server alerts, sent by osbot (bots/osbot/osbot/ops_alerts.py) every 5 min:
//
//   POST ops-alerts/check  evaluates the server (lib/server.ts), records what
//                          changed in ops_alert_state and returns what the
//                          owner hasn't been told yet: new problems
//                          ("firing") and problems that went away ("resolved")
//   POST ops-alerts/ack    after the bot sent them
//
// Send first, ack after: a crash between the two repeats a message, never
// loses one. The state lives in Postgres, so restarts and deploys of the bot
// don't repeat anything. Kinds the owner switched off are not tracked at all;
// a mute only holds the messages back (they go out when it ends, if still
// relevant).

export type AlertEvent = "firing" | "resolved"

export type AlertNotification = {
  key: string
  kind: OpsAlertKind
  event: AlertEvent
  title: string
  detail: string
  /** When the problem started (firing) or ended (resolved). */
  since: string
}

export type AlertCheckResult = {
  checkedAt: string
  /** Problems right now (switched-off kinds excluded), muted or not. */
  firing: { key: string; kind: OpsAlertKind; title: string; since: string }[]
  mutedUntil: string | null
  notifications: AlertNotification[]
}

export type AlertSettings = { disabledKinds: OpsAlertKind[]; mutedUntil: string | null }

const kindSchema = z.enum(opsAlertKinds)

export const alertSettingsInput = z.object({
  disabledKinds: z.array(kindSchema).max(opsAlertKinds.length),
  /** ISO time, or null to unmute. */
  mutedUntil: z.iso.datetime({ offset: true }).nullable(),
})

export const ackAlertsInput = z.object({
  items: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_.:-]{0,199}$/),
        event: z.enum(["firing", "resolved"]),
      }),
    )
    .min(1)
    .max(100),
})

/** What evaluateAlerts needs, read live from the agent, the certificates and the service list. */
export async function collectAlertInput(): Promise<AlertInput> {
  const status = await loadServerStatus()
  let services: AlertInput["services"] = null
  if (!status.offline) {
    const res = await agentRequest<{ services: AgentService[] }>("GET", "/services?stats=0")
    if (res.ok && res.status === 200 && Array.isArray(res.data.services)) services = res.data.services
  }
  return { host: status.host, offline: status.offline, certs: status.certs, services }
}

async function requireOwner() {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") throw new Error("Only the owner gets server alerts.")
  return viewer
}

export async function getAlertSettings(): Promise<AlertSettings> {
  await requireOwner()
  const [row] = await asViewer((tx) => tx.select().from(opsAlertSettings))
  return { disabledKinds: row?.disabledKinds ?? [], mutedUntil: row?.mutedUntil?.toISOString() ?? null }
}

export async function saveAlertSettings(input: z.infer<typeof alertSettingsInput>): Promise<AlertSettings> {
  await requireOwner()
  const disabledKinds = [...new Set(input.disabledKinds)]
  const mutedUntil = input.mutedUntil ? new Date(input.mutedUntil) : null
  await asViewer((tx) =>
    tx
      .insert(opsAlertSettings)
      .values({ disabledKinds, mutedUntil })
      .onConflictDoUpdate({ target: opsAlertSettings.ownerId, set: { disabledKinds, mutedUntil } }),
  )
  return { disabledKinds, mutedUntil: mutedUntil?.toISOString() ?? null }
}

/**
 * Records the current alerts and returns what to send. `alerts` comes from
 * evaluateAlerts(); passing it in keeps this testable without an agent.
 */
export async function recordAlerts(alerts: Alert[], now = new Date()): Promise<AlertCheckResult> {
  await requireOwner()
  return asViewer(async (tx) => {
    const [settings] = await tx.select().from(opsAlertSettings)
    const disabled = new Set<OpsAlertKind>(settings?.disabledKinds ?? [])
    const mutedUntil = settings?.mutedUntil && settings.mutedUntil > now ? settings.mutedUntil : null

    const current = new Map(alerts.filter((a) => !disabled.has(a.kind)).map((a) => [a.key, a]))
    const rows = await tx.select().from(opsAlertState)
    const known = new Map(rows.map((r) => [r.key, r]))

    // Switched-off kinds aren't tracked: forget them, so switching one back
    // on announces a problem that is still there.
    if (disabled.size) {
      await tx.delete(opsAlertState).where(inArray(opsAlertState.kind, [...disabled]))
      for (const r of rows) if (disabled.has(r.kind)) known.delete(r.key)
    }

    for (const a of current.values()) {
      const row = known.get(a.key)
      if (!row) {
        const [inserted] = await tx
          .insert(opsAlertState)
          .values({ key: a.key, kind: a.kind, title: a.title, detail: a.detail, firing: true, since: now })
          .returning()
        known.set(a.key, inserted!)
      } else if (!row.firing || row.title !== a.title || row.detail !== a.detail) {
        const [updated] = await tx
          .update(opsAlertState)
          .set({ firing: true, title: a.title, detail: a.detail, kind: a.kind, ...(row.firing ? {} : { since: now }) })
          .where(eq(opsAlertState.id, row.id))
          .returning()
        known.set(a.key, updated!)
      }
    }
    for (const row of known.values()) {
      if (row.firing && !current.has(row.key)) {
        const [updated] = await tx
          .update(opsAlertState)
          .set({ firing: false, since: now })
          .where(eq(opsAlertState.id, row.id))
          .returning()
        known.set(row.key, updated!)
      }
    }
    // Over and done with: resolved, and the owner either never heard of it or
    // already got the recovery.
    const done = [...known.values()].filter((r) => !r.firing && !r.notifiedFiring)
    if (done.length) {
      await tx.delete(opsAlertState).where(inArray(opsAlertState.id, done.map((r) => r.id)))
      for (const r of done) known.delete(r.key)
    }

    const live = [...known.values()]
    const pending = mutedUntil ? [] : live.filter((r) => r.firing !== r.notifiedFiring)
    return {
      checkedAt: now.toISOString(),
      firing: live
        .filter((r) => r.firing)
        .sort((a, b) => a.since.getTime() - b.since.getTime() || a.key.localeCompare(b.key))
        .map((r) => ({ key: r.key, kind: r.kind, title: r.title, since: r.since.toISOString() })),
      mutedUntil: mutedUntil?.toISOString() ?? null,
      notifications: pending
        // Problems first, oldest first; then recoveries.
        .sort(
          (a, b) => Number(b.firing) - Number(a.firing) || a.since.getTime() - b.since.getTime() || a.key.localeCompare(b.key),
        )
        .map((r) => ({
          key: r.key,
          kind: r.kind,
          event: r.firing ? "firing" : "resolved",
          title: r.title,
          detail: r.detail,
          since: r.since.toISOString(),
        })),
    }
  })
}

/** Evaluates the server now and records it: the osbot check. */
export async function checkAlerts(now = new Date()): Promise<AlertCheckResult> {
  await requireOwner()
  const input = await collectAlertInput()
  return recordAlerts(evaluateAlerts(input, now), now)
}

/** Marks notifications as sent. Only if the state is still what was sent. */
export async function ackAlerts({ items }: z.infer<typeof ackAlertsInput>, now = new Date()): Promise<{ acked: number }> {
  await requireOwner()
  return asViewer(async (tx) => {
    let acked = 0
    for (const { key, event } of items) {
      const firing = event === "firing"
      const res = await tx
        .update(opsAlertState)
        .set({ notifiedFiring: firing, notifiedAt: now })
        .where(and(eq(opsAlertState.key, key), eq(opsAlertState.firing, firing)))
        .returning({ id: opsAlertState.id })
      acked += res.length
    }
    return { acked }
  })
}
