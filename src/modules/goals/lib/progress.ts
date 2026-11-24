import type { GoalProgress, GoalStatus } from "../schema"

type Measure = {
  status: GoalStatus
  targetValue: number | null
  targetUnit: string
  currentValue: number
  tasksDone: number
  tasksTotal: number
}

/**
 * A measurable goal ("20 books") counts its own number; otherwise the share of
 * its linked tasks that are done. An achieved goal is full whatever the count
 * says. Ratios are clamped to 0..1 (reading 23 of 20 books is still 100 %).
 */
export function goalProgress(g: Measure): GoalProgress {
  const doneBoost = g.status === "done" ? 1 : null
  if (g.targetValue !== null && g.targetValue > 0) {
    const ratio = doneBoost ?? clamp(g.currentValue / g.targetValue)
    return { kind: "target", current: g.currentValue, target: g.targetValue, unit: g.targetUnit, ratio }
  }
  if (g.tasksTotal > 0) {
    return { kind: "tasks", done: g.tasksDone, total: g.tasksTotal, ratio: doneBoost ?? clamp(g.tasksDone / g.tasksTotal) }
  }
  return doneBoost ? { kind: "tasks", done: 0, total: 0, ratio: 1 } : { kind: "none", ratio: null }
}

function clamp(n: number) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

/** "12", "2.5", "1,250" — whole numbers stay whole. */
export function formatAmount(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)
}

/** The line under a goal's bar: "12 of 20 books", "3 of 8 tasks", "No measure yet". */
export function progressLabel(p: GoalProgress, locale: string) {
  switch (p.kind) {
    case "target":
      return `${formatAmount(p.current, locale)} of ${formatAmount(p.target, locale)}${p.unit ? ` ${p.unit}` : ""}`
    case "tasks":
      return p.total === 0 ? "Achieved" : `${p.done} of ${p.total} ${p.total === 1 ? "task" : "tasks"}`
    case "none":
      return "No measure yet"
  }
}

export function percent(p: GoalProgress) {
  return p.ratio === null ? null : Math.round(p.ratio * 100)
}

/**
 * Where the year is, as a ratio, to compare a goal against ("on track" when its
 * progress keeps up with the calendar). Day of year / days in year.
 */
export function yearElapsed({ year, month, day }: { year: number; month: number; day: number }) {
  const start = Date.UTC(year, 0, 1)
  const days = (Date.UTC(year + 1, 0, 1) - start) / 86_400_000
  return ((Date.UTC(year, month - 1, day) - start) / 86_400_000 + 1) / days
}

export type Pace = "ahead" | "on-track" | "behind" | null

/** Only for this year's active, measured goals; a 10-point margin either side is "on track". */
export function pace(p: GoalProgress, status: GoalStatus, elapsed: number | null): Pace {
  if (status !== "active" || p.ratio === null || elapsed === null) return null
  const diff = p.ratio - elapsed
  if (diff > 0.1) return "ahead"
  if (diff < -0.1) return "behind"
  return "on-track"
}

export const paceLabels: Record<Exclude<Pace, null>, string> = {
  ahead: "Ahead",
  "on-track": "On track",
  behind: "Behind",
}
