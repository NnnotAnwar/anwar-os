import type { OpsErrorRouteType, OpsErrorSource, OpsErrorStatus } from "@/db/schema/ops"

// The error log read back (Ops → Errors and the Telegram alerts): the 24-hour
// series, labels, the alert budget and the list's optimistic moves. Pure and
// free of Node APIs, so the client panel can use it (errors-view.test.ts).
// Capture, scrubbing and fingerprints live in errors.ts.

/** Telegram messages about errors per rolling hour (singles + the summary). */
export const ERROR_ALERTS_PER_HOUR = 4

const HOUR = 3_600_000

/**
 * The stored 24 hourly counts (oldest first, the last one being the hour of
 * `hourlyAt`) slid to the current hour: always 24 numbers, the last one for
 * this hour.
 */
export function hourlySeries(hourly: number[], hourlyAt: Date | string, now: Date): number[] {
  const at = Math.floor(new Date(hourlyAt).getTime() / HOUR)
  const shift = Math.floor(now.getTime() / HOUR) - at
  const base = hourly.length === 24 ? hourly : [...Array(24 - Math.min(24, hourly.length)).fill(0), ...hourly.slice(-24)]
  if (shift <= 0) return base
  if (shift >= 24) return Array(24).fill(0)
  return [...base.slice(shift), ...Array(shift).fill(0)]
}

export function last24h(hourly: number[], hourlyAt: Date | string, now: Date): number {
  return hourlySeries(hourly, hourlyAt, now).reduce((a, b) => a + b, 0)
}

export const routeTypeLabels: Record<OpsErrorRouteType, string> = {
  render: "Page",
  route: "Route handler",
  action: "Server action",
  proxy: "Proxy",
  process: "Background",
  bot: "Bot",
  "": "Unknown",
}

export const sourceLabels: Record<OpsErrorSource, string> = { web: "Web", osbot: "osbot", "expense-bot": "Expense bot" }

/** "GET /app/notes/[id]", "Server action /app/ops", "osbot · capture". */
export function errorWhere(e: { source: OpsErrorSource; route: string; method: string; routeType: OpsErrorRouteType }): string {
  if (e.source !== "web") return [sourceLabels[e.source], e.route].filter(Boolean).join(" · ")
  if (!e.route) return routeTypeLabels[e.routeType]
  if (e.routeType === "action") return `Server action ${e.route}`
  return `${e.method ? `${e.method} ` : ""}${e.route}`
}

export type AlertPlan<T> = {
  /** Sent one by one, with Open and Resolve. */
  singles: T[]
  /** Folded into one summary message. */
  summary: T[]
  /** Over the hour's budget: kept for a later check. */
  held: T[]
}

/**
 * At most ERROR_ALERTS_PER_HOUR messages an hour: pending errors go out
 * one by one while the budget lasts; when there are more than that, the last
 * message of the budget is a summary of the rest. Nothing is left for the
 * hour: everything else waits.
 */
export function planErrorAlerts<T>(pending: T[], sentLastHour: number, perHour: number = ERROR_ALERTS_PER_HOUR): AlertPlan<T> {
  const budget = Math.max(0, perHour - sentLastHour)
  if (!pending.length || budget === 0) return { singles: [], summary: [], held: pending }
  if (pending.length <= budget) return { singles: pending, summary: [], held: [] }
  return { singles: pending.slice(0, budget - 1), summary: pending.slice(budget - 1), held: [] }
}

type Listed = { id: string; status: OpsErrorStatus; resolvedAt: string | null; lastSeen: string }

/**
 * The list after Resolve (or its Undo), before the server answers: the group
 * moves between open (newest seen first) and resolved (newest resolved first).
 */
export function moveError<T extends Listed>(view: { open: T[]; resolved: T[] }, id: string, status: OpsErrorStatus, nowIso: string) {
  const group = view.open.find((g) => g.id === id) ?? view.resolved.find((g) => g.id === id)
  if (!group || group.status === status) return view
  const moved = { ...group, status, resolvedAt: status === "resolved" ? nowIso : null }
  const open = view.open.filter((g) => g.id !== id)
  const resolved = view.resolved.filter((g) => g.id !== id)
  if (status === "resolved") return { open, resolved: [moved, ...resolved] }
  return { open: [...open, moved].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)), resolved }
}
