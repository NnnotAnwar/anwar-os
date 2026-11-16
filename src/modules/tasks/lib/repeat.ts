// Repeating tasks reuse the calendar's RRULE subset and expansion. A task's
// series is anchored on its own due date; completing it spawns the next one.
import { expandEvent, parseRRule } from "@/modules/calendar/lib/recurrence"
import { addDays, compareDates, formatIsoDate, parseIsoDate, utcDate, utcMidnight, type LocalDate } from "@/modules/calendar/lib/zoned"

/** Tasks support every calendar rule except COUNT (a spawned series can't keep count). */
export function isTaskRRule(value: string) {
  const rule = parseRRule(value)
  return rule !== null && !rule.count
}

/**
 * The due date after `due` for a repeating task, skipping any that are already
 * in the past (completing a long-overdue weekly task lands on the next one
 * from today, not on a backlog). Null once the series has ended.
 */
export function nextDueDate(rrule: string, due: LocalDate, today: LocalDate): LocalDate | null {
  const rule = parseRRule(rrule)
  if (!rule) return null
  const tomorrowOfDue = addDays(due, 1)
  const from = compareDates(tomorrowOfDue, today) >= 0 ? tomorrowOfDue : today
  const span = { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[rule.freq] * rule.interval
  const start = utcMidnight(due)
  const [next] = expandEvent(
    { start, end: new Date(start.getTime() + 86_400_000), allDay: true, timezone: "UTC", rrule },
    utcMidnight(from),
    utcMidnight(addDays(from, span * 2 + 62)),
    1,
  )
  return next ? utcDate(next.start) : null
}

/** ISO-string convenience for the server. */
export function nextDueIso(rrule: string, dueIso: string, today: LocalDate): string | null {
  const due = parseIsoDate(dueIso)
  if (!due) return null
  const next = nextDueDate(rrule, due, today)
  return next ? formatIsoDate(next) : null
}
