import { z } from "zod"
import { opsActions, opsResults, type OpsAction, type OpsEventDetail, type OpsResult } from "@/db/schema/ops"

export { opsActions, opsResults, type OpsAction, type OpsResult, type OpsEventDetail }

/** A service as ops-agent reports it (GET /services). */
export type AgentService = {
  name: string
  container: string
  image: string
  tag: string
  revision?: string
  state: "running" | "exited" | "restarting" | "paused" | "created" | "dead" | "removing"
  health: "healthy" | "unhealthy" | "starting" | "none"
  started_at?: string
  finished_at?: string
  exit_code: number
  /** The kernel killed it for exceeding its memory limit. */
  oom_killed?: boolean
  restart_count: number
  protected: boolean
  role?: string
  kind?: string
  bot_name?: string
  cpu_percent: number | null
  mem_bytes: number | null
  mem_limit_bytes: number | null
}

export type LogLine = { ts: string; stream: "stdout" | "stderr"; text: string }

export type DeployOutcome = {
  ok: boolean
  tag: string
  previous_tag: string
  rolled_back: boolean
  error?: string
  logs?: LogLine[]
  seconds: number
  service?: AgentService
}

/** Why the panel can't show live data. */
export type Offline =
  | { reason: "not_configured" }
  | { reason: "unreachable"; message: string }
  | { reason: "unauthorized" }
  | { reason: "error"; message: string }

export type ServicesResult = { connected: true; services: AgentService[]; agentVersion: string } | ({ connected: false } & Offline)

export type OpsEvent = {
  id: string
  actor: string
  service: string
  action: OpsAction
  detail: OpsEventDetail
  result: OpsResult
  error: string | null
  durationMs: number | null
  createdAt: string
}

export type ImageTag = {
  tag: string
  /** Full commit sha when the tag is one. */
  sha?: string
  message?: string
  date?: string
  current: boolean
}

export const serviceName = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/, "Unknown service.")
export const tagName = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "Tags are letters, digits, '_', '.' and '-'.")

export const controlInput = z.object({
  service: serviceName,
  action: z.enum(["start", "stop", "restart"]),
  /** The event this call undoes, for the audit trail. */
  undoOf: z.uuid().optional(),
})
export const deployInput = z.object({ service: serviceName, tag: tagName, undoOf: z.uuid().optional() })
export const logsInput = z.object({ service: serviceName, tail: z.number().int().min(1).max(1000).default(200) })
export const tagsInput = z.object({ service: serviceName })
export const eventsInput = z.object({
  service: serviceName.optional(),
  limit: z.number().int().min(1).max(200).default(30),
})

export const actionLabels: Record<OpsAction, string> = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  deploy: "Deploy",
}
