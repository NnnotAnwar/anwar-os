import { addDays, daysBetween, isScheduled } from "./days"

// Streaks count scheduled days only: a habit done Mon/Wed/Fri keeps its streak
// over Tuesday. Today never breaks a streak (there's still time), and checks on
// unscheduled days neither add to nor break one.

/** Days walked back at most (a little over five years). */
const MAX_DAYS = 2000

export function currentStreak(mask: number, done: ReadonlySet<string>, today: string) {
  let streak = 0
  let day = today
  for (let i = 0; i < MAX_DAYS; i++, day = addDays(day, -1)) {
    if (!isScheduled(mask, day)) continue
    if (done.has(day)) streak++
    else if (day !== today) break
  }
  return streak
}

/** The longest run of consecutive scheduled days done, from the first check up to today. */
export function bestStreak(mask: number, done: ReadonlySet<string>, today: string) {
  let first: string | null = null
  for (const day of done) if (day <= today && (first === null || day < first)) first = day
  if (first === null) return 0
  const span = Math.min(daysBetween(first, today), MAX_DAYS)
  let best = 0
  let run = 0
  for (let i = span; i >= 0; i--) {
    const day = addDays(today, -i)
    if (!isScheduled(mask, day)) continue
    if (done.has(day)) best = Math.max(best, ++run)
    else if (day !== today) run = 0
  }
  return best
}

/** The `count` days ending today, oldest first. */
export function recentDays(mask: number, done: ReadonlySet<string>, today: string, count = 30) {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(today, i - count + 1)
    return { day, scheduled: isScheduled(mask, day), done: done.has(day) }
  })
}
