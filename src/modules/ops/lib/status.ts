import type { AgentService } from "../schema"

/** One word for the dot and the sentence beside it. */
export type Status = "ok" | "starting" | "attention" | "down" | "stopped"

type StatusFields = Pick<AgentService, "state" | "health" | "exit_code" | "oom_killed">

/** Exit codes of a deliberate stop: clean exit, SIGTERM (143), or SIGKILL after the grace period (137). */
const STOP_CODES = new Set([0, 137, 143])

export function serviceStatus(s: StatusFields): Status {
  if (s.state === "running") {
    if (s.health === "unhealthy") return "attention"
    if (s.health === "starting") return "starting"
    return "ok"
  }
  if (s.state === "restarting") return "attention"
  if (s.state === "created" || s.state === "paused") return "stopped"
  // exited / dead: what `docker stop` leaves behind is "stopped"; a crash or an
  // out-of-memory kill is "down".
  return s.state === "exited" && !s.oom_killed && STOP_CODES.has(s.exit_code) ? "stopped" : "down"
}

/** Services the owner should look at: unhealthy, crashing, or down. Stopped on purpose doesn't count. */
export function needsAttention(s: StatusFields) {
  const st = serviceStatus(s)
  return st === "attention" || st === "down"
}

export const statusLabels: Record<Status, string> = {
  ok: "Running",
  starting: "Starting",
  attention: "Needs attention",
  down: "Down",
  stopped: "Stopped",
}

/** Status dot colours: green / amber / red / grey (the only non-accent colours on the page). */
export const statusDot: Record<Status, string> = {
  ok: "bg-emerald-500",
  starting: "bg-amber-400 animate-pulse",
  attention: "bg-amber-500",
  down: "bg-destructive",
  stopped: "bg-muted-foreground/50",
}

/** "3 d 4 h", "12 min", "40 s": the two largest units. */
export function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const units: [string, number][] = [
    ["d", 86_400],
    ["h", 3_600],
    ["min", 60],
    ["s", 1],
  ]
  const parts: string[] = []
  let rest = s
  for (const [label, size] of units) {
    const n = Math.floor(rest / size)
    if (n > 0 || (parts.length === 0 && size === 1)) parts.push(`${n} ${label}`)
    rest -= n * size
    if (parts.length === 2) break
  }
  return parts.join(" ")
}

/** "up 3 d 4 h" / "stopped 12 min ago", or null without timestamps. */
export function uptimeLabel(s: Pick<AgentService, "state" | "started_at" | "finished_at">, now: Date) {
  if (s.state === "running" && s.started_at) {
    return `up ${formatDuration(now.getTime() - new Date(s.started_at).getTime())}`
  }
  if (s.finished_at) return `stopped ${formatDuration(now.getTime() - new Date(s.finished_at).getTime())} ago`
  return null
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** Memory limit as Docker reports it: the host's RAM when the container has no limit. */
export function memoryLabel(s: Pick<AgentService, "mem_bytes" | "mem_limit_bytes">) {
  if (s.mem_bytes == null) return null
  return s.mem_limit_bytes ? `${formatBytes(s.mem_bytes)} / ${formatBytes(s.mem_limit_bytes)}` : formatBytes(s.mem_bytes)
}

/** A 40-char sha tag reads as its first 7 characters. */
export function shortTag(tag: string) {
  return /^[0-9a-f]{40}$/.test(tag) ? tag.slice(0, 7) : tag
}

/** Order on the panel: what needs attention first, then by role, then by name. */
const roleOrder: Record<string, number> = { bot: 0, app: 1, edge: 2, data: 3 }
export function sortServices<T extends AgentService>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      Number(needsAttention(b)) - Number(needsAttention(a)) ||
      (roleOrder[a.role ?? ""] ?? 9) - (roleOrder[b.role ?? ""] ?? 9) ||
      a.name.localeCompare(b.name),
  )
}

/** "All 6 services running" / "2 of 6 need attention". */
export function summary(services: StatusFields[]) {
  const bad = services.filter(needsAttention).length
  if (services.length === 0) return "No managed services yet"
  if (bad === 0) return `All ${services.length} ${services.length === 1 ? "service" : "services"} running`
  return `${bad} of ${services.length} ${bad === 1 ? "needs" : "need"} attention`
}
