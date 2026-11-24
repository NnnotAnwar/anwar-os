// Weekday masks and plain ISO day arithmetic for habits. Days are "YYYY-MM-DD"
// strings in the user's calendar; all math is done at UTC midnight, so no time
// zone or DST can shift a day.

export const EVERY_DAY = 0b111_1111
export const WEEKDAYS = 0b001_1111
export const WEEKENDS = 0b110_0000

/** Monday first, matching the mask's bit order. */
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export const WEEKDAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"] as const

const DAY_MS = 86_400_000

function toUtc(iso: string) {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
}

function fromUtc(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number) {
  return fromUtc(toUtc(iso) + days * DAY_MS)
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(iso: string) {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7
}

export function isScheduled(mask: number, iso: string) {
  return (mask & (1 << weekdayOf(iso))) !== 0
}

export function hasDay(mask: number, weekday: number) {
  return (mask & (1 << weekday)) !== 0
}

export function toggleDay(mask: number, weekday: number) {
  return mask ^ (1 << weekday)
}

/** "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri". */
export function describeSchedule(mask: number) {
  if (mask === EVERY_DAY) return "Every day"
  if (mask === WEEKDAYS) return "Weekdays"
  if (mask === WEEKENDS) return "Weekends"
  return WEEKDAY_SHORT.filter((_, i) => hasDay(mask, i)).join(", ")
}

/** "2026-11" → every day of that month. */
export function daysOfMonth(month: string) {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)
}

export function shiftMonth(month: string, by: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}
