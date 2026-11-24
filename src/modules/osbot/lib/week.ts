// Weeks for the weekly review: Monday to Sunday, as ISO calendar dates in the
// owner's timezone. Pure.

import { addDaysIso, parseIsoDate } from "@/modules/budget/lib/dates"

export type Week = { start: string; end: string }

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const d = parseIsoDate(date)!
  const day = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
  return day === 0 ? 7 : day
}

/** The Monday-to-Sunday week `date` falls in. */
export function weekOf(date: string): Week {
  const start = addDaysIso(date, 1 - isoWeekday(date))
  return { start, end: addDaysIso(start, 6) }
}

export function shiftWeek(week: Week, by: number): Week {
  return { start: addDaysIso(week.start, 7 * by), end: addDaysIso(week.end, 7 * by) }
}

export const isMonday = (date: string) => parseIsoDate(date) !== null && isoWeekday(date) === 1

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "16–22 Nov", "30 Nov – 6 Dec", "29 Dec 2025 – 4 Jan 2026". */
export function weekLabel({ start, end }: Week): string {
  const a = parseIsoDate(start)!
  const b = parseIsoDate(end)!
  if (a.year !== b.year) return `${a.day} ${MONTHS[a.month - 1]} ${a.year} – ${b.day} ${MONTHS[b.month - 1]} ${b.year}`
  if (a.month !== b.month) return `${a.day} ${MONTHS[a.month - 1]} – ${b.day} ${MONTHS[b.month - 1]}`
  return `${a.day}–${b.day} ${MONTHS[b.month - 1]}`
}
