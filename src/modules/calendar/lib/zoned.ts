// Wall-clock <-> instant conversion for IANA zones, using only Intl.
// Pure functions: safe on the server, in the browser and in tests.

export type LocalDate = { year: number; month: number; day: number }
export type LocalDateTime = LocalDate & { hour: number; minute: number }

const DAY = 86_400_000
const MINUTE = 60_000

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string) {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** True for zones Intl knows (e.g. "Europe/Prague", "UTC"). */
export function isValidTimeZone(timeZone: string) {
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}

/** The wall clock `instant` shows in `timeZone` (seconds dropped). */
export function wallClock(instant: Date, timeZone: string): LocalDateTime {
  const parts = formatter(timeZone).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") }
}

/** UTC offset of `timeZone` at `instant`, in minutes (Prague in winter: 60). */
export function offsetMinutes(instant: Date, timeZone: string) {
  const w = wallClock(instant, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  const truncated = Math.floor(instant.getTime() / MINUTE) * MINUTE
  return Math.round((asUtc - truncated) / MINUTE)
}

const sameWall = (a: LocalDateTime, b: LocalDateTime) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute

/**
 * The instant a wall-clock time in `timeZone` refers to. Follows RFC 5545:
 * an ambiguous time (autumn fold) resolves to the first occurrence; a time
 * skipped by a spring-forward gap moves forward by the gap (02:30 → 03:30).
 */
export function zonedToUtc(local: LocalDateTime, timeZone: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  const before = offsetMinutes(new Date(guess - DAY), timeZone)
  const after = offsetMinutes(new Date(guess + DAY), timeZone)
  const candidates = [...new Set([before, after])]
    .map((offset) => guess - offset * MINUTE)
    .filter((t) => sameWall(wallClock(new Date(t), timeZone), local))
    .sort((a, b) => a - b)
  if (candidates.length) return new Date(candidates[0]!)
  // In a gap: read the wall time with the offset in force before it.
  return new Date(guess - before * MINUTE)
}

/** Midnight at the start of `date` in `timeZone`. */
export function startOfLocalDay(date: LocalDate, timeZone: string) {
  return zonedToUtc({ ...date, hour: 0, minute: 0 }, timeZone)
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: LocalDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() || 7
}

/** Whole days from `a` to `b`. */
export function diffDays(a: LocalDate, b: LocalDate) {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY)
}

export function compareDates(a: LocalDate, b: LocalDate) {
  return diffDays(b, a)
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0")

/** "2026-11-16" */
export function formatIsoDate(date: LocalDate) {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`
}

/** Parses "2026-11-16"; null for anything else, including impossible dates. */
export function parseIsoDate(value: string | undefined | null): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "")
  if (!m) return null
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null
  return date
}

/** "09:05" */
export function formatTime(local: Pick<LocalDateTime, "hour" | "minute">) {
  return `${pad(local.hour)}:${pad(local.minute)}`
}

/** Parses "9:05" / "09:05"; null when out of range. */
export function parseTime(value: string | undefined | null): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "")
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  return hour < 24 && minute < 60 ? { hour, minute } : null
}

/** The calendar date of an all-day boundary (stored as UTC midnight). */
export function utcDate(instant: Date): LocalDate {
  return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() }
}

export function utcMidnight(date: LocalDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day))
}
