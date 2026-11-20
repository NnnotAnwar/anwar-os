// Calendar dates as ISO strings ("2026-11-16") and months as "2026-11".
// Transactions happen on a date, not at an instant, so there is no timezone
// here except when asking what "today" is for the viewer.

import { daysInMonth, formatIsoDate, parseIsoDate, wallClock, type LocalDate } from "@/modules/calendar/lib/zoned"

export { daysInMonth, formatIsoDate, parseIsoDate, type LocalDate }

/** The viewer's calendar date right now. */
export function todayIn(timeZone: string, now = new Date()): string {
  const w = wallClock(now, timeZone)
  return formatIsoDate({ year: w.year, month: w.month, day: w.day })
}

function valid(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return formatIsoDate({ year, month, day })
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/**
 * Reads the dates banks and people write: "2026-11-16", "16.11.2026",
 * "16. 11. 2026", "16.11.26", "16/11/2026", optionally followed by a time.
 * With `today`, a year-less "16.11." means that day in today's year.
 * Returns an ISO date or null.
 */
export function parseDate(input: string | null | undefined, today?: string): string | null {
  const text = (input ?? "").trim()
  if (!text) return null

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text)
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]))

  m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?:\s.*)?$/.exec(text)
  if (m) return valid(fullYear(m[3]!), Number(m[2]), Number(m[1]))

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s.*)?$/.exec(text)
  if (m) {
    // Day first, as in Europe; switch only when that can't be a date.
    const a = Number(m[1])
    const b = Number(m[2])
    const year = fullYear(m[3]!)
    return valid(year, b, a) ?? valid(year, a, b)
  }

  m = /^(\d{1,2})\.\s?(\d{1,2})\.?$/.exec(text)
  if (m && today) return valid(Number(today.slice(0, 4)), Number(m[2]), Number(m[1]))

  return null
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso)!
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days))
  return formatIsoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() })
}

/**
 * `months` after `iso`, on `anchorDay` (default: the date's own day) or the
 * last day of a shorter month: Jan 31 + 1 month → Feb 28.
 */
export function addMonthsIso(iso: string, months: number, anchorDay?: number): string {
  const d = parseIsoDate(iso)!
  const index = d.year * 12 + (d.month - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const day = Math.min(anchorDay ?? d.day, daysInMonth(year, month))
  return formatIsoDate({ year, month, day })
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

export const isMonth = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

export const monthOf = (iso: string) => iso.slice(0, 7)

export function monthRange(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(year, m)).padStart(2, "0")}` }
}

export function shiftMonth(month: string, by: number): string {
  return monthOf(addMonthsIso(`${month}-01`, by))
}

/** Whole months from `a` to `b` ("2026-01" → "2026-03" is 2). */
export function monthsBetween(a: string, b: string) {
  return Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7)) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)))
}

/** "November 2026" / "listopad 2026". */
export function formatMonth(month: string, locale = "en", style: "long" | "short" = "long") {
  const [y, m] = month.split("-").map(Number)
  return new Intl.DateTimeFormat(locale, { month: style, year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, 1)),
  )
}

/** "16 Nov" (this year) or "16 Nov 2025". */
export function formatDay(iso: string, locale = "en", today?: string) {
  const d = parseIsoDate(iso)
  if (!d) return iso
  const sameYear = today ? today.slice(0, 4) === iso.slice(0, 4) : false
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)))
}
