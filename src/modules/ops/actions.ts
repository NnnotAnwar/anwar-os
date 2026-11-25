import "server-only"
import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer, type Viewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { opsEvents } from "@/db/schema"
import { agentRequest, isAgentError, offlineMessage } from "./agent"
import { alertSettingsInput, getAlertSettings, saveAlertSettings, type AlertSettings } from "./alerts"
import {
  errorStatusInput,
  listErrors,
  listErrorsInput,
  openErrorCount,
  setErrorStatus,
  type ErrorStatusResult,
  type ErrorsView,
} from "./errors"
import {
  deleteOrphans,
  deleteOrphansInput,
  getFilesCheck,
  runFilesCheck,
  runFilesCheckInput,
  type DeleteOrphansResult,
  type FilesCheckView,
  type RunResult,
} from "./files-check"
import { imageTags, type TagsResult } from "./ghcr"
import { loadServerStatus, type ServerStatus } from "./host"
import type { DrillState } from "./lib/drill"
import { getDrillState } from "./restore-drill"
import {
  controlInput,
  deployInput,
  eventsInput,
  logsInput,
  tagsInput,
  type AgentService,
  type DeployOutcome,
  type LogLine,
  type Offline,
  type OpsAction,
  type OpsEvent,
  type OpsEventDetail,
  type OpsResult,
  type ServicesResult,
} from "./schema"
import { needsAttention } from "./lib/status"

/** Container control is the site owner's alone, whatever RLS would allow. */
async function requireOwner(): Promise<Viewer> {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") throw new Error("Only the owner can use the control panel.")
  return viewer
}

const svcPath = (name: string) => `/services/${encodeURIComponent(name)}` as const

export type ControlResult =
  | { ok: true; service: AgentService; eventId: string }
  | { ok: false; error: string; refused?: boolean; eventId?: string }

export type DeployResult =
  | { ok: true; outcome: DeployOutcome; eventId: string }
  | { ok: false; error: string; outcome?: DeployOutcome; eventId?: string }

// The audit trail: one row per request to the agent, written before the call
// (pending) and finalized after, in short transactions of their own so a
// four-minute deploy never holds a database transaction open.
async function begin(viewer: Viewer, service: string, action: OpsAction, detail: OpsEventDetail) {
  const [row] = await asViewer((tx) =>
    tx
      .insert(opsEvents)
      .values({ actor: viewer.displayName ?? viewer.email ?? "", service, action, detail })
      .returning({ id: opsEvents.id }),
  )
  return { id: row!.id, started: Date.now() }
}

async function finish(
  ev: { id: string; started: number },
  result: Exclude<OpsResult, "pending">,
  error: string | null,
  detail?: OpsEventDetail,
) {
  await asViewer((tx) =>
    tx
      .update(opsEvents)
      .set({
        result,
        error: error?.slice(0, 2000) ?? null,
        durationMs: Date.now() - ev.started,
        ...(detail ? { detail } : {}),
      })
      .where(eq(opsEvents.id, ev.id)),
  )
}

function toEvent(row: typeof opsEvents.$inferSelect): OpsEvent {
  return {
    id: row.id,
    actor: row.actor,
    service: row.service,
    action: row.action,
    detail: row.detail,
    result: row.result,
    error: row.error,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  }
}

export const actions = {
  services: defineAction({
    description:
      "List the services (Docker containers) the control panel manages: state, health, uptime, image tag, restarts, CPU and memory. Says when the panel is not connected.",
    kind: "read",
    input: z.object({ stats: z.boolean().default(true) }),
    handler: async ({ stats }): Promise<ServicesResult> => {
      await requireOwner()
      const res = await agentRequest<{ services: AgentService[]; agent: { version: string } }>(
        "GET",
        stats ? "/services" : "/services?stats=0",
      )
      if (!res.ok) return { connected: false, ...toOffline(res) }
      if (res.status !== 200 || !Array.isArray(res.data.services)) {
        return { connected: false, reason: "error", message: isAgentError(res.data) ? res.data.message : "Unexpected answer from the agent." }
      }
      return { connected: true, services: res.data.services, agentVersion: res.data.agent?.version ?? "" }
    },
  }),

  attentionCount: defineAction({
    description: "How many managed services are unhealthy, crashing or down. Null when the panel is not connected.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<number | null> => {
      const res = await actions.services.handler({ stats: false })
      return res.connected ? res.services.filter(needsAttention).length : null
    },
  }),

  logs: defineAction({
    description: "The last log lines (stdout and stderr, with timestamps) of one managed service.",
    kind: "read",
    input: logsInput,
    handler: async ({ service, tail }): Promise<{ ok: true; lines: LogLine[] } | { ok: false; error: string }> => {
      await requireOwner()
      const res = await agentRequest<{ lines: LogLine[] }>("GET", `${svcPath(service)}/logs?tail=${tail}`)
      if (!res.ok) return { ok: false, error: offlineMessage(res) }
      if (res.status !== 200) return { ok: false, error: isAgentError(res.data) ? res.data.message : "Couldn't read the logs." }
      return { ok: true, lines: res.data.lines }
    },
  }),

  control: defineAction({
    description:
      "Start, stop or restart one managed service. Protected services (web, database, proxy, the agent) can't be stopped. Recorded in the activity log.",
    kind: "write",
    input: controlInput,
    handler: async ({ service, action, undoOf }): Promise<ControlResult> => {
      const viewer = await requireOwner()
      const ev = await begin(viewer, service, action, undoOf ? { undoOf } : {})
      const res = await agentRequest<{ ok: true; service: AgentService }>("POST", `${svcPath(service)}/${action}`, undefined, 100_000)
      if (!res.ok) {
        const error = offlineMessage(res)
        await finish(ev, "error", error)
        return { ok: false, error, eventId: ev.id }
      }
      if (res.status !== 200 || isAgentError(res.data)) {
        const refused = res.status === 403 || res.status === 404 || res.status === 409
        const error = isAgentError(res.data) ? res.data.message : `The agent answered ${res.status}.`
        await finish(ev, refused ? "refused" : "error", error)
        return { ok: false, error, refused, eventId: ev.id }
      }
      await finish(ev, "ok", null)
      return { ok: true, service: res.data.service, eventId: ev.id }
    },
  }),

  deploy: defineAction({
    description:
      "Deploy another image tag of one managed service: pull it, replace the container, wait for its healthcheck, roll back automatically on failure. Protected services can't be deployed. Recorded in the activity log.",
    kind: "write",
    input: deployInput,
    handler: async ({ service, tag, undoOf }): Promise<DeployResult> => {
      const viewer = await requireOwner()
      const ev = await begin(viewer, service, "deploy", { tag, ...(undoOf ? { undoOf } : {}) })
      // The agent waits up to its deploy timeout (default 240 s) plus the pull.
      const res = await agentRequest<DeployOutcome | { error: string; message: string }>(
        "POST",
        `${svcPath(service)}/deploy`,
        { tag },
        10 * 60_000,
      )
      if (!res.ok) {
        const error = offlineMessage(res)
        await finish(ev, "error", error)
        return { ok: false, error, eventId: ev.id }
      }
      if (isAgentError(res.data)) {
        const refused = res.status === 403 || res.status === 404 || res.status === 409
        await finish(ev, refused ? "refused" : "error", res.data.message)
        return { ok: false, error: res.data.message, eventId: ev.id }
      }
      const outcome = res.data
      const detail: OpsEventDetail = {
        tag,
        previousTag: outcome.previous_tag,
        rolledBack: outcome.rolled_back,
        ...(undoOf ? { undoOf } : {}),
      }
      if (!outcome.ok) {
        const error = outcome.rolled_back
          ? `${outcome.error ?? "Deploy failed"}. Rolled back to ${outcome.previous_tag}.`
          : (outcome.error ?? "Deploy failed.")
        await finish(ev, "error", error, detail)
        return { ok: false, error, outcome, eventId: ev.id }
      }
      await finish(ev, "ok", null, detail)
      return { ok: true, outcome, eventId: ev.id }
    },
  }),

  tags: defineAction({
    description: "Recent image tags of a managed service from GHCR, with the matching commit message and date.",
    kind: "read",
    input: tagsInput,
    handler: async ({ service }): Promise<TagsResult> => {
      await requireOwner()
      const res = await agentRequest<AgentService>("GET", `${svcPath(service)}`)
      if (!res.ok) return { ok: false, error: offlineMessage(res) }
      if (res.status !== 200 || isAgentError(res.data)) return { ok: false, error: "Unknown service." }
      return imageTags(res.data.image, res.data.tag)
    },
  }),

  server: defineAction({
    description:
      "The server's vital signs: disk, memory and swap, load, uptime, kernel, pending reboot, Docker disk usage, the last backup and the TLS certificate expiry of every site the edge serves.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<ServerStatus> => {
      await requireOwner()
      return loadServerStatus()
    },
  }),

  alertSettings: defineAction({
    description: "Which server alerts osbot sends (kinds switched off) and whether they are muted until a time.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<AlertSettings> => getAlertSettings(),
  }),

  updateAlertSettings: defineAction({
    description:
      "Switch server alert kinds off or on (disk, memory, backup, cert, container, reboot, agent, files, errors, drill) and mute all of them until a time (null = unmute).",
    kind: "write",
    input: alertSettingsInput,
    handler: async (input): Promise<AlertSettings> => saveAlertSettings(input),
  }),

  filesCheck: defineAction({
    description:
      "The last files storage check: how many objects and bytes the bucket holds, and files whose object is missing or has the wrong size, plus orphaned objects no file points at.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<FilesCheckView> => getFilesCheck(),
  }),

  runFilesCheck: defineAction({
    description: "Run the files storage check now: compare every file with the objects in the bucket (a few per hour at most).",
    kind: "write",
    input: runFilesCheckInput,
    handler: async (input): Promise<RunResult> => runFilesCheck(input, { limit: true }),
  }),

  deleteFileOrphans: defineAction({
    description:
      "Delete orphaned objects from the files storage (objects no file points at, older than a day), by key from the last check. Each is re-checked first; files are never touched.",
    kind: "write",
    input: deleteOrphansInput,
    handler: async (input): Promise<DeleteOrphansResult> => deleteOrphans(input),
  }),

  errors: defineAction({
    description:
      "The error log: server errors of the web app and the bots, grouped by cause, with how often and where they happened, the latest stack, open or resolved.",
    kind: "read",
    input: listErrorsInput,
    handler: async (input): Promise<ErrorsView> => listErrors(input),
  }),

  openErrorCount: defineAction({
    description: "How many error groups in the error log are unresolved.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<number> => openErrorCount(),
  }),

  setErrorStatus: defineAction({
    description: "Resolve an error group in the error log, or put it back (open). A resolved error that happens again reopens on its own.",
    kind: "write",
    input: errorStatusInput,
    handler: async (input): Promise<ErrorStatusResult> => setErrorStatus(input),
  }),

  restoreDrill: defineAction({
    description: "The monthly restore drill: the latest run and the latest passing one (backup restored, checks, rows, duration).",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<DrillState> => getDrillState(),
  }),

  events: defineAction({
    description: "The control panel's activity log, newest first: who started, stopped, restarted or deployed what, when, and how it ended.",
    kind: "read",
    input: eventsInput,
    handler: async ({ service, limit }): Promise<OpsEvent[]> => {
      await requireOwner()
      const rows = await asViewer((tx) =>
        tx
          .select()
          .from(opsEvents)
          .where(service ? eq(opsEvents.service, service) : undefined)
          .orderBy(desc(opsEvents.createdAt))
          .limit(limit),
      )
      return rows.map(toEvent)
    },
  }),
}

function toOffline(r: Offline): Offline {
  switch (r.reason) {
    case "not_configured":
    case "unauthorized":
      return { reason: r.reason }
    case "unreachable":
    case "error":
      return { reason: r.reason, message: r.message }
  }
}
