// Calendar helpers that work in the viewer's timezone, not the server's.

export type CalendarDate = { year: number; month: number; day: number; weekday: number }

/** The calendar date `instant` falls on in `timeZone` (weekday: 1 = Monday … 7 = Sunday). */
export function calendarDate(instant: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdays.indexOf(get("weekday")) + 1,
  }
}

const DAY = 86_400_000
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

/** ISO-8601 week number and week-year of a calendar date. */
export function isoWeek({ year, month, day }: Pick<CalendarDate, "year" | "month" | "day">) {
  const date = new Date(utc(year, month, day))
  const weekday = date.getUTCDay() || 7
  // The Thursday of this week decides which year the week belongs to.
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const weekYear = date.getUTCFullYear()
  const week = Math.ceil(((date.getTime() - utc(weekYear, 1, 1)) / DAY + 1) / 7)
  return { week, weekYear }
}

/** 52 or 53: a year has 53 ISO weeks when Dec 28 falls in week 53. */
export function isoWeeksInYear(year: number) {
  return isoWeek({ year, month: 12, day: 28 }).week
}

export function daysLeftInYear({ year, month, day }: Pick<CalendarDate, "year" | "month" | "day">) {
  return Math.round((utc(year, 12, 31) - utc(year, month, day)) / DAY)
}

/** Monday and Sunday (UTC dates) of ISO week `week` in `weekYear`. */
export function isoWeekRange(weekYear: number, week: number) {
  const jan4 = new Date(utc(weekYear, 1, 4))
  const monday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY + (week - 1) * 7 * DAY
  return { start: new Date(monday), end: new Date(monday + 6 * DAY) }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", 3_600_000],
  ["minute", 60_000],
]

/** "5 min ago", "yesterday", "3 wk ago". Under a minute reads "just now". */
export function formatRelative(then: Date, now: Date, locale: string) {
  const diff = then.getTime() - now.getTime()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  const thisMinute = rtf.format(0, "minute")
  // English renders "this minute"; "just now" reads better in a list of edits.
  return thisMinute === "this minute" ? "just now" : thisMinute
}
