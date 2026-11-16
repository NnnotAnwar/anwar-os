// RFC 5545 serializer for the private ICS feed. Timed events carry
// TZID + a generated VTIMEZONE (so recurring events keep their wall-clock time
// across DST in every client); all-day events use VALUE=DATE.

import { daysInMonth, offsetMinutes, utcDate, wallClock, weekdayOf } from "./zoned"

export type IcsEvent = {
  id: string
  title: string
  notes: string
  location: string
  category: string
  start: Date
  end: Date
  allDay: boolean
  timezone: string
  rrule: string | null
  reminders: number[]
  createdAt: Date
  updatedAt: Date
}

const CRLF = "\r\n"
const pad = (n: number, width = 2) => String(n).padStart(width, "0")

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

const encoder = new TextEncoder()

/**
 * Folds a content line at 75 octets (RFC 5545 §3.1): continuation lines start
 * with one space. Never splits a UTF-8 sequence or a surrogate pair.
 */
export function foldLine(line: string) {
  const out: string[] = []
  let current = ""
  let octets = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    const limit = out.length === 0 ? 75 : 74
    if (octets + size > limit) {
      out.push(current)
      current = ""
      octets = 0
    }
    current += char
    octets += size
  }
  out.push(current)
  return out.join(`${CRLF} `)
}

export function formatUtc(instant: Date) {
  return (
    `${pad(instant.getUTCFullYear(), 4)}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}` +
    `T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}${pad(instant.getUTCSeconds())}Z`
  )
}

function formatDate(instant: Date) {
  const d = utcDate(instant)
  return `${pad(d.year, 4)}${pad(d.month)}${pad(d.day)}`
}

function formatLocal(instant: Date, timeZone: string) {
  const w = wallClock(instant, timeZone)
  return `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}00`
}

function formatOffset(minutes: number) {
  const sign = minutes < 0 ? "-" : "+"
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
}

type Transition = { at: Date; from: number; to: number }

/** Offset changes of `timeZone` during `year`, found by scanning days then bisecting to the minute. */
export function transitionsInYear(timeZone: string, year: number): Transition[] {
  const result: Transition[] = []
  const DAY = 86_400_000
  let prevTime = Date.UTC(year, 0, 1)
  let prevOffset = offsetMinutes(new Date(prevTime), timeZone)
  for (let t = prevTime + DAY; t <= Date.UTC(year + 1, 0, 1); t += DAY) {
    const offset = offsetMinutes(new Date(t), timeZone)
    if (offset !== prevOffset) {
      let lo = prevTime
      let hi = t
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000
        if (offsetMinutes(new Date(mid), timeZone) === prevOffset) lo = mid
        else hi = mid
      }
      result.push({ at: new Date(hi), from: prevOffset, to: offset })
    }
    prevTime = t
    prevOffset = offset
  }
  return result
}

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]

/** The date in `year` that is the n-th (or last, n = -1) `weekday` of `month`. */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  if (n > 0) {
    const first = weekdayOf({ year, month, day: 1 })
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
  }
  const lastDay = daysInMonth(year, month)
  const last = weekdayOf({ year, month, day: lastDay })
  return lastDay - ((last - weekday + 7) % 7)
}

/**
 * A VTIMEZONE for `timeZone`, derived from Intl: the DST rules observed in
 * `year` expressed as yearly RRULEs (e.g. last Sunday of March), anchored in
 * 1970. Zones without DST get a single STANDARD component.
 */
export function vtimezone(timeZone: string, year: number): string[] {
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`]
  const transitions = transitionsInYear(timeZone, year)
  if (transitions.length === 0) {
    const offset = formatOffset(offsetMinutes(new Date(Date.UTC(year, 0, 1)), timeZone))
    lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`)
    lines.push("END:STANDARD")
  } else {
    for (const t of transitions) {
      // The local time the change happens at, read on the old offset.
      const local = new Date(t.at.getTime() + t.from * 60_000)
      const month = local.getUTCMonth() + 1
      const day = local.getUTCDate()
      const weekday = local.getUTCDay() || 7
      const n = day + 7 > daysInMonth(year, month) ? -1 : Math.ceil(day / 7)
      const anchorDay = nthWeekday(1970, month, weekday, n)
      const kind = t.to > t.from ? "DAYLIGHT" : "STANDARD"
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:1970${pad(month)}${pad(anchorDay)}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}00`,
        `RRULE:FREQ=YEARLY;BYMONTH=${month};BYDAY=${n}${DAY_CODES[weekday - 1]}`,
        `TZOFFSETFROM:${formatOffset(t.from)}`,
        `TZOFFSETTO:${formatOffset(t.to)}`,
        `END:${kind}`,
      )
    }
  }
  lines.push("END:VTIMEZONE")
  return lines
}

function alarmTrigger(minutes: number) {
  return minutes === 0 ? "PT0M" : `-PT${minutes}M`
}

function eventLines(event: IcsEvent, host: string, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@${host}`,
    `DTSTAMP:${formatUtc(now)}`,
    `CREATED:${formatUtc(event.createdAt)}`,
    `LAST-MODIFIED:${formatUtc(event.updatedAt)}`,
  ]
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDate(event.start)}`)
    // DTEND is exclusive; a zero-length all-day event still covers its day.
    const end = event.end > event.start ? event.end : new Date(event.start.getTime() + 86_400_000)
    lines.push(`DTEND;VALUE=DATE:${formatDate(end)}`)
  } else {
    lines.push(`DTSTART;TZID=${event.timezone}:${formatLocal(event.start, event.timezone)}`)
    lines.push(`DTEND;TZID=${event.timezone}:${formatLocal(event.end, event.timezone)}`)
  }
  if (event.rrule) lines.push(`RRULE:${event.rrule}`)
  lines.push(`SUMMARY:${escapeText(event.title)}`)
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`)
  lines.push(`CATEGORIES:${escapeText(event.category)}`)
  if (event.allDay) lines.push("TRANSP:TRANSPARENT")
  for (const minutes of event.reminders) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.title)}`,
      `TRIGGER:${alarmTrigger(minutes)}`,
      "END:VALARM",
    )
  }
  lines.push("END:VEVENT")
  return lines
}

/** A complete VCALENDAR document with CRLF line endings and folded lines. */
export function serializeCalendar({
  name,
  events,
  host,
  now,
}: {
  name: string
  events: IcsEvent[]
  host: string
  now: Date
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//anwar.os//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ]
  const zones = [...new Set(events.filter((e) => !e.allDay).map((e) => e.timezone))].sort()
  for (const zone of zones) lines.push(...vtimezone(zone, now.getUTCFullYear()))
  for (const event of events) lines.push(...eventLines(event, host, now))
  lines.push("END:VCALENDAR")
  return lines.map(foldLine).join(CRLF) + CRLF
}
