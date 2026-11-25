import "server-only"
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer, type Viewer } from "@/core/auth"
import { asPublic, type Tx } from "@/db"
import { opsAlertSettings, opsErrors, type OpsErrorRouteType, type OpsErrorSource, type OpsErrorStatus } from "@/db/schema"
import { toErrorRecord, type ErrorContext } from "./lib/errors"
import { errorWhere, ERROR_ALERTS_PER_HOUR, planErrorAlerts } from "./lib/errors-view"

// The error log (Ops → Errors). Writes come from places with no viewer:
//   - src/instrumentation.ts: Next's onRequestError (pages, route handlers,
//     server actions, the proxy) and unhandled rejections / exceptions;
//   - the internal API wrapper (src/core/internal-api.ts) for handler failures
//     it answers with a 500 itself;
//   - the bots' own unhandled exceptions, reported through their APIs.
// Each goes through toErrorRecord() (scrub + fingerprint) and then
// app.record_error() (security definer: rate cap, row cap, retention).
//
// Telegram: the 5-minute server-alert check (alerts.ts) also returns errors
// that are new or came back, at most ERROR_ALERTS_PER_HOUR messages an
// hour (the rest in one summary), as the alert kind "errors" (switch off, mute).

export type ErrorGroup = {
  id: string
  source: OpsErrorSource
  name: string
  message: string
  route: string
  method: string
  routeType: OpsErrorRouteType
  renderSource: string
  digest: string
  stack: string
  count: number
  hourly: number[]
  hourlyAt: string
  firstSeen: string
  lastSeen: string
  status: OpsErrorStatus
  resolvedAt: string | null
  reopenedCount: number
}

export type ErrorsView = { open: ErrorGroup[]; resolved: ErrorGroup[] }

export type RecordOutcome = "new" | "reopened" | "seen" | "dropped"

/**
 * Records a thrown value. Never throws and never logs the value itself (Next
 * already did); returns what happened, or null when it was left out (Next's
 * control flow) or couldn't be written.
 */
export async function recordError(value: unknown, ctx: ErrorContext): Promise<RecordOutcome | null> {
  try {
    const r = toErrorRecord(value, { cwd: process.cwd(), ...ctx })
    if (!r) return null
    const rows = await asPublic((tx) =>
      tx.execute<{ outcome: RecordOutcome }>(sql`
        select app.record_error(${r.source}, ${r.fingerprint}, ${r.name}, ${r.message}, ${r.route}, ${r.method},
          ${r.routeType}, ${r.renderSource}, ${r.digest}, ${r.stack}) as outcome`),
    )
    return rows[0]?.outcome ?? null
  } catch (error) {
    console.error("error log: couldn't record an error", error instanceof Error ? error.message : error)
    return null
  }
}

/** What a bot sends about its own unhandled exception (osbot, the expense bot). */
export const botErrorInput = z.object({
  name: z.string().trim().min(1).max(200).default("Error"),
  message: z.string().max(4000).default(""),
  /** The Python traceback. */
  stack: z.string().max(20_000).default(""),
  /** Which loop or handler, e.g. "ops-alerts" or "capture". */
  where: z.string().trim().max(100).default(""),
})

export async function recordBotError(source: Exclude<OpsErrorSource, "web">, input: z.infer<typeof botErrorInput>) {
  const outcome = await recordError(
    { name: input.name, message: input.message, stack: input.stack },
    { source, route: input.where.replace(/[^\w ./:-]/g, ""), routeType: "bot", cwd: "/app" },
  )
  return { recorded: outcome !== null && outcome !== "dropped", outcome }
}

// ---------------------------------------------------------------------------
// Reading and resolving (the owner)
// ---------------------------------------------------------------------------

async function requireOwner(): Promise<Viewer> {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") throw new Error("Only the owner can see the error log.")
  return viewer
}

function toGroup(r: typeof opsErrors.$inferSelect): ErrorGroup {
  return {
    id: r.id,
    source: r.source,
    name: r.name,
    message: r.message,
    route: r.route,
    method: r.method,
    routeType: r.routeType,
    renderSource: r.renderSource,
    digest: r.digest,
    stack: r.stack,
    count: r.count,
    hourly: r.hourly,
    hourlyAt: r.hourlyAt.toISOString(),
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    status: r.status,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    reopenedCount: r.reopenedCount,
  }
}

export const listErrorsInput = z.object({
  openLimit: z.number().int().min(1).max(200).default(100),
  resolvedLimit: z.number().int().min(0).max(100).default(20),
})

/** Open groups (most recent first) and the latest resolved ones. */
export async function listErrors({ openLimit, resolvedLimit }: z.infer<typeof listErrorsInput>): Promise<ErrorsView> {
  await requireOwner()
  return asViewer(async (tx) => {
    const open = await tx.select().from(opsErrors).where(eq(opsErrors.status, "open")).orderBy(desc(opsErrors.lastSeen)).limit(openLimit)
    const resolved = resolvedLimit
      ? await tx.select().from(opsErrors).where(eq(opsErrors.status, "resolved")).orderBy(desc(opsErrors.resolvedAt)).limit(resolvedLimit)
      : []
    return { open: open.map(toGroup), resolved: resolved.map(toGroup) }
  })
}

/** Unresolved groups: the Ops card's badge. */
export async function openErrorCount(): Promise<number> {
  await requireOwner()
  const [row] = await asViewer((tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(opsErrors).where(eq(opsErrors.status, "open")),
  )
  return row?.n ?? 0
}

export const errorStatusInput = z.object({
  id: z.uuid(),
  status: z.enum(["open", "resolved"]),
})

export type ErrorStatusResult = { id: string; status: OpsErrorStatus; previous: OpsErrorStatus }

export class ErrorNotFound extends Error {
  constructor() {
    super("That error isn't in the log any more.")
  }
}

/**
 * Resolve, or put back (Undo). Resolving ends a pending Telegram alert; putting
 * back by hand never starts one. An error that happens again after being
 * resolved reopens on its own (app.record_error).
 */
export async function setErrorStatus({ id, status }: z.infer<typeof errorStatusInput>, now = new Date()): Promise<ErrorStatusResult> {
  await requireOwner()
  return asViewer(async (tx) => {
    const [row] = await tx.select({ status: opsErrors.status }).from(opsErrors).where(eq(opsErrors.id, id)).for("update")
    if (!row) throw new ErrorNotFound()
    await tx
      .update(opsErrors)
      .set(status === "resolved" ? { status, resolvedAt: now, alertPending: false } : { status, resolvedAt: null })
      .where(eq(opsErrors.id, id))
    return { id, status, previous: row.status }
  })
}

// ---------------------------------------------------------------------------
// Telegram (osbot, through the server-alert check)
// ---------------------------------------------------------------------------

export type ErrorNotification = {
  id: string
  event: "new" | "reopened"
  name: string
  message: string
  /** "GET /app/notes/[id]", "Server action /app/ops", "osbot · capture". */
  where: string
  count: number
  lastSeen: string
}

export type ErrorAlerts = {
  items: ErrorNotification[]
  /** More than the hour's budget: one message for these. */
  summary: { ids: string[]; count: number; titles: string[] } | null
  /** Waiting for the mute or the hourly budget to end. */
  held: number
}

const NONE: ErrorAlerts = { items: [], summary: null, held: 0 }

function toNotification(r: typeof opsErrors.$inferSelect): ErrorNotification {
  return {
    id: r.id,
    event: r.reopenedCount > 0 ? "reopened" : "new",
    name: r.name,
    message: r.message.slice(0, 300),
    where: errorWhere(r),
    count: r.count,
    lastSeen: r.lastSeen.toISOString(),
  }
}

/**
 * What to tell the owner about errors now. Switched off: nothing, and the
 * pending ones are dropped (switching back on doesn't replay them). Muted:
 * held. Otherwise planned within the hourly budget.
 */
export async function pendingErrorAlerts(now = new Date()): Promise<ErrorAlerts> {
  await requireOwner()
  return asViewer(async (tx) => {
    const [settings] = await tx.select().from(opsAlertSettings)
    if (settings?.disabledKinds.includes("errors")) {
      await tx.update(opsErrors).set({ alertPending: false }).where(eq(opsErrors.alertPending, true))
      return NONE
    }
    const pending = await tx
      .select()
      .from(opsErrors)
      .where(and(eq(opsErrors.alertPending, true), eq(opsErrors.status, "open")))
      .orderBy(desc(opsErrors.count), desc(opsErrors.lastSeen))
      .limit(50)
    if (!pending.length) return NONE
    if (settings?.mutedUntil && settings.mutedUntil > now) return { ...NONE, held: pending.length }

    const sent = await sentLastHour(tx, now)
    const plan = planErrorAlerts(pending, sent, ERROR_ALERTS_PER_HOUR)
    return {
      items: plan.singles.map(toNotification),
      summary: plan.summary.length
        ? {
            ids: plan.summary.map((r) => r.id),
            count: plan.summary.length,
            titles: plan.summary.slice(0, 5).map((r) => `${r.name}: ${r.message}`.slice(0, 120)),
          }
        : null,
      held: plan.held.length,
    }
  })
}

/** Messages sent in the last hour: each ack stamps its errors with one alerted_at. */
async function sentLastHour(tx: Tx, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(distinct ${opsErrors.alertedAt})::int` })
    .from(opsErrors)
    .where(gt(opsErrors.alertedAt, new Date(now.getTime() - 3_600_000)))
  return row?.n ?? 0
}

export const ackErrorAlertsInput = z.object({ ids: z.array(z.uuid()).min(1).max(100) })

/** After osbot sent one message (a single error, or the summary of several). */
export async function ackErrorAlerts({ ids }: z.infer<typeof ackErrorAlertsInput>, now = new Date()): Promise<{ acked: number }> {
  await requireOwner()
  const rows = await asViewer((tx) =>
    tx
      .update(opsErrors)
      .set({ alertPending: false, alertedAt: now })
      .where(and(inArray(opsErrors.id, [...new Set(ids)]), eq(opsErrors.alertPending, true)))
      .returning({ id: opsErrors.id }),
  )
  return { acked: rows.length }
}

