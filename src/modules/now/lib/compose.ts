import { goalProgress } from "@/modules/goals/lib/progress"
import type { NowGoal, NowHabits } from "../schema"

// Pure pieces of the /now page, unit tested: which projects it lists, how the
// habits line reads and which date "Updated" shows.

/** A row of app.now_goals(), as postgres.js returns it. */
export type NowGoalRow = {
  id: string
  title: string
  target_value: number | null
  target_unit: string
  current_value: number
  status: string
  tasks_done: number
  tasks_total: number
  updated_at: Date | string
}

export function toNowGoal(row: NowGoalRow): NowGoal {
  // The function never returns dropped goals; anything else unexpected reads as active.
  const status = row.status === "done" ? "done" : "active"
  return {
    id: row.id,
    title: row.title,
    status,
    progress: goalProgress({
      status,
      targetValue: row.target_value === null ? null : Number(row.target_value),
      targetUnit: row.target_unit,
      currentValue: Number(row.current_value),
      tasksDone: Number(row.tasks_done),
      tasksTotal: Number(row.tasks_total),
    }),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

type ProjectLike = { id: string; status: string; featured: boolean }

/**
 * Projects being built now first, then the featured ones, each group in the
 * owner's order (the input's). Ideas, paused and archived projects only make it
 * in when featured.
 */
export function pickNowProjects<P extends ProjectLike>(projects: readonly P[], limit = 4): P[] {
  const building = projects.filter((p) => p.status === "building")
  const featured = projects.filter((p) => p.featured && p.status !== "building")
  return [...building, ...featured].slice(0, limit)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "4 daily habits · longest streak 23 days"; null when there's nothing to say. */
export function habitsLine(h: NowHabits | null): string | null {
  if (!h || h.habits <= 0) return null
  const count = h.daily === h.habits ? plural(h.habits, "daily habit", "daily habits") : plural(h.habits, "habit", "habits")
  return h.longestStreak > 0 ? `${count} · longest streak ${plural(h.longestStreak, "day", "days")}` : count
}

/** The newest of the given timestamps (ISO strings), or null when there are none. */
export function latestDate(dates: readonly (string | null | undefined)[]): string | null {
  let best: number | null = null
  for (const d of dates) {
    if (!d) continue
    const t = Date.parse(d)
    if (Number.isFinite(t) && (best === null || t > best)) best = t
  }
  return best === null ? null : new Date(best).toISOString()
}
