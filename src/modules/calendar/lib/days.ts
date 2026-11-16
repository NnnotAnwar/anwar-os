// Placing occurrences on the viewer's calendar days. Client-safe.
import type { Occurrence } from "../schema"
import { addDays, compareDates, formatIsoDate, utcDate, wallClock, weekdayOf, type LocalDate } from "./zoned"

/** The local dates an occurrence covers (end exclusive), capped for long spans. */
export function occurrenceDates(o: Pick<Occurrence, "start" | "end" | "allDay">, timeZone: string): string[] {
  const start = new Date(o.start)
  const end = new Date(o.end)
  let first: LocalDate
  let last: LocalDate
  if (o.allDay) {
    first = utcDate(start)
    last = end > start ? addDays(utcDate(end), -1) : first
  } else {
    first = wallClock(start, timeZone)
    // An event ending exactly at midnight doesn't spill into the next day.
    last = end > start ? wallClock(new Date(end.getTime() - 1), timeZone) : first
  }
  const out: string[] = []
  for (let d = first, i = 0; compareDates(d, last) <= 0 && i < 62; d = addDays(d, 1), i++) out.push(formatIsoDate(d))
  return out
}

/** Occurrences grouped by ISO date, each day's list in start order. */
export function groupByDay(occurrences: Occurrence[], timeZone: string) {
  const map = new Map<string, Occurrence[]>()
  for (const o of occurrences) {
    for (const day of occurrenceDates(o, timeZone)) {
      const list = map.get(day) ?? []
      list.push(o)
      map.set(day, list)
    }
  }
  return map
}

/** Monday on or before `date`. */
export function startOfWeek(date: LocalDate) {
  return addDays(date, 1 - weekdayOf(date))
}

/** The 6×7 grid for the month containing `date`, starting on a Monday. */
export function monthGrid(date: LocalDate) {
  const first = { year: date.year, month: date.month, day: 1 }
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const index = date.month - 1 + months
  const year = date.year + Math.floor(index / 12)
  const month = (((index % 12) + 12) % 12) + 1
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, day: Math.min(date.day, dim) }
}

export const sameDay = (a: LocalDate, b: LocalDate) => compareDates(a, b) === 0

/** Minutes since local midnight of `day` at which `instant` falls, clamped to the day. */
export function minutesIntoDay(instant: Date, day: LocalDate, timeZone: string) {
  const w = wallClock(instant, timeZone)
  const cmp = compareDates(w, day)
  if (cmp < 0) return 0
  if (cmp > 0) return 24 * 60
  return w.hour * 60 + w.minute
}
