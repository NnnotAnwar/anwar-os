// The RRULE subset the calendar supports, and expansion of a recurring event
// into concrete instances for a date range. Instances are computed on read and
// never stored. Expansion works on wall-clock time in the event's zone, so a
// weekly 09:00 meeting stays at 09:00 across daylight-saving changes.
//
// Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (weekly only,
// plain weekdays), COUNT, UNTIL. Monthly/yearly repeat on the start's day of
// month; months without that day are skipped (RFC 5545 behaviour), so a series
// on the 31st skips 30-day months and Feb 29 only recurs in leap years.

import { formatDayMonth, formatWeekdayShort } from "./format"
import {
  addDays,
  daysInMonth,
  diffDays,
  utcDate,
  wallClock,
  weekdayOf,
  zonedToUtc,
  type LocalDate,
  type LocalDateTime,
} from "./zoned"

export const frequencies = ["daily", "weekly", "monthly", "yearly"] as const
export type Frequency = (typeof frequencies)[number]

/** 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type Recurrence = {
  freq: Frequency
  interval: number
  /** Weekly only. Defaults to the start's weekday. */
  byWeekday?: Weekday[]
  /** Total number of instances, the first included. */
  count?: number
  /** Last instant an instance may start at (inclusive). */
  until?: Date
}

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const
const MAX_INTERVAL = 999
const MAX_COUNT = 5000

const pad = (n: number, width = 2) => String(n).padStart(width, "0")

function formatUntil(until: Date, allDay: boolean) {
  const y = pad(until.getUTCFullYear(), 4)
  const mo = pad(until.getUTCMonth() + 1)
  const d = pad(until.getUTCDate())
  if (allDay) return `${y}${mo}${d}`
  return `${y}${mo}${d}T${pad(until.getUTCHours())}${pad(until.getUTCMinutes())}${pad(until.getUTCSeconds())}Z`
}

function parseUntil(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0)))
  return Number.isNaN(date.getTime()) ? null : date
}

/** RRULE value (without the "RRULE:" prefix). UNTIL is a DATE for all-day events, UTC otherwise. */
export function formatRRule(rule: Recurrence, allDay: boolean): string {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.freq === "weekly" && rule.byWeekday?.length) {
    const days = [...new Set(rule.byWeekday)].sort((a, b) => a - b)
    parts.push(`BYDAY=${days.map((d) => DAY_CODES[d - 1]).join(",")}`)
  }
  if (rule.count) parts.push(`COUNT=${rule.count}`)
  else if (rule.until) parts.push(`UNTIL=${formatUntil(rule.until, allDay)}`)
  return parts.join(";")
}

/** Parses the supported subset; null for anything outside it. */
export function parseRRule(value: string | null | undefined): Recurrence | null {
  if (!value) return null
  const fields = new Map<string, string>()
  for (const part of value.replace(/^RRULE:/i, "").split(";")) {
    const [key, val] = part.split("=")
    if (!key || val === undefined || fields.has(key.toUpperCase())) return null
    fields.set(key.toUpperCase(), val.toUpperCase())
  }

  const freq = fields.get("FREQ")?.toLowerCase()
  if (!frequencies.includes(freq as Frequency)) return null
  const rule: Recurrence = { freq: freq as Frequency, interval: 1 }

  for (const [key, val] of fields) {
    switch (key) {
      case "FREQ":
        break
      case "INTERVAL": {
        const n = Number(val)
        if (!Number.isInteger(n) || n < 1 || n > MAX_INTERVAL) return null
        rule.interval = n
        break
      }
      case "COUNT": {
        const n = Number(val)
        if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) return null
        rule.count = n
        break
      }
      case "UNTIL": {
        const until = parseUntil(val)
        if (!until) return null
        rule.until = until
        break
      }
      case "BYDAY": {
        if (rule.freq !== "weekly") return null
        const days = val.split(",").map((code) => DAY_CODES.indexOf(code as (typeof DAY_CODES)[number]) + 1)
        if (!days.length || days.some((d) => d < 1)) return null
        rule.byWeekday = [...new Set(days)].sort((a, b) => a - b) as Weekday[]
        break
      }
      case "WKST":
        if (val !== "MO") return null
        break
      default:
        return null
    }
  }
  if (rule.count && rule.until) return null
  return rule
}

export type ExpandableEvent = {
  start: Date
  end: Date
  allDay: boolean
  timezone: string
  rrule: string | null
}

export type Instance = { start: Date; end: Date }

const overlaps = (start: Date, end: Date, from: Date, to: Date) =>
  start < to && (end > from || (end.getTime() === start.getTime() && start >= from))

/** Candidate dates in order, before COUNT/UNTIL are applied. `skip` jumps ahead whole periods. */
function* candidateDates(rule: Recurrence, base: LocalDate, skip: number): Generator<LocalDate> {
  const { interval } = rule
  switch (rule.freq) {
    case "daily":
      for (let k = skip; ; k++) yield addDays(base, k * interval)
    case "weekly": {
      const days = rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(base) as Weekday]
      const monday = addDays(base, 1 - weekdayOf(base))
      for (let k = skip; ; k++) {
        for (const wd of days) {
          const date = addDays(monday, k * 7 * interval + wd - 1)
          if (diffDays(base, date) >= 0) yield date
        }
      }
    }
    case "monthly":
      for (let k = skip; ; k++) {
        const index = base.month - 1 + k * interval
        const year = base.year + Math.floor(index / 12)
        const month = (index % 12) + 1
        if (base.day <= daysInMonth(year, month)) yield { year, month, day: base.day }
      }
    case "yearly":
      for (let k = skip; ; k++) {
        const year = base.year + k * interval
        if (base.day <= daysInMonth(year, base.month)) yield { year, month: base.month, day: base.day }
      }
  }
}

/**
 * Every instance of `event` that overlaps [from, to). A non-recurring event
 * yields itself when it overlaps. Instance length equals the event's length.
 */
export function expandEvent(event: ExpandableEvent, from: Date, to: Date, maxInstances = 1000): Instance[] {
  const rule = parseRRule(event.rrule)
  if (!rule) return overlaps(event.start, event.end, from, to) ? [{ start: event.start, end: event.end }] : []

  const duration = event.end.getTime() - event.start.getTime()
  const wall: LocalDateTime = event.allDay
    ? { ...utcDate(event.start), hour: 0, minute: 0 }
    : wallClock(event.start, event.timezone)
  const base: LocalDate = { year: wall.year, month: wall.month, day: wall.day }
  const toInstant = (date: LocalDate) =>
    event.allDay
      ? new Date(Date.UTC(date.year, date.month - 1, date.day))
      : zonedToUtc({ ...date, hour: wall.hour, minute: wall.minute }, event.timezone)

  // Without COUNT, whole periods that end before the range can be skipped:
  // nothing earlier than `from - duration` can overlap it.
  let skip = 0
  if (!rule.count && (rule.freq === "daily" || rule.freq === "weekly")) {
    const periodDays = (rule.freq === "daily" ? 1 : 7) * rule.interval
    const earliest = from.getTime() - duration - 2 * 86_400_000
    const days = Math.floor((earliest - event.start.getTime()) / 86_400_000)
    skip = Math.max(0, Math.floor(days / periodDays) - 1)
  }

  const instances: Instance[] = []
  let seen = 0
  let steps = 0
  for (const date of candidateDates(rule, base, skip)) {
    if (++steps > 200_000) break
    const start = toInstant(date)
    if (start < event.start) continue
    if (rule.until && start > rule.until) break
    if (start >= to) break
    seen++
    if (rule.count && seen > rule.count) break
    const end = new Date(start.getTime() + duration)
    if (overlaps(start, end, from, to)) {
      instances.push({ start, end })
      if (instances.length >= maxInstances) break
    }
  }
  return instances
}

/** "Every 2 weeks on Mon, Wed, until 31 Dec 2026", for the editor and agenda. */
export function describeRecurrence(rule: Recurrence, locale: string, allDay: boolean, timeZone: string): string {
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[rule.freq]
  let text =
    rule.interval === 1
      ? { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[rule.freq]
      : `Every ${rule.interval} ${unit}s`
  if (rule.freq === "weekly" && rule.byWeekday?.length) {
    // 2024-01-01 is a Monday.
    text += ` on ${rule.byWeekday.map((d) => formatWeekdayShort(new Date(Date.UTC(2024, 0, d)), locale, "UTC")).join(", ")}`
  }
  if (rule.count) text += `, ${rule.count} ${rule.count === 1 ? "time" : "times"}`
  else if (rule.until) {
    text += `, until ${formatDayMonth(rule.until, locale, allDay ? "UTC" : timeZone, true)}`
  }
  return text
}
