// "Dentist tomorrow 14:00" → a draft event. A time or time range ("14:00",
// "9:30-11", "7pm-8:30pm"), and a date the way task quick add reads one
// ("tomorrow", "fri", "next monday", "31 Dec", "31.12.", "zítra", "in 3 days").
// Relative words count from `base`, the day picked in the calendar. Everything
// else is the title.

import { parseWhen } from "@/modules/tasks/lib/parse"
import type { LocalDate } from "./zoned"

export type QuickDraft = {
  title: string
  date: LocalDate
  /** Absent for an all-day event. */
  time?: { start: { hour: number; minute: number }; end: { hour: number; minute: number } }
}

type Clock = { hour: number; minute: number }

const TIME = String.raw`([01]?\d|2[0-3])[:.]([0-5]\d)`
const RANGE = new RegExp(String.raw`(?:^|\s)(?:at\s+)?${TIME}(?:\s*[-–]\s*${TIME})?(?=\s|$)`, "i")
// 7pm-8pm, 7-8:30pm, 9:30am-12pm: the end's am/pm also covers a bare start.
const MERIDIEM_RANGE = /(?:^|\s)(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s?([ap]m)?\s*[-–]\s*(\d{1,2})(?::([0-5]\d))?\s?([ap]m)(?=\s|$)/i

const minutes = (c: Clock) => c.hour * 60 + c.minute

function from12(hour: number, minute: number, meridiem: string): Clock | null {
  if (hour < 1 || hour > 12) return null
  const pm = meridiem.toLowerCase() === "pm"
  return { hour: (hour % 12) + (pm ? 12 : 0), minute }
}

/** One hour by default (or when the end isn't after the start), capped at the end of the day. */
function span(start: Clock, end: Clock | null): NonNullable<QuickDraft["time"]> {
  if (end && minutes(end) > minutes(start)) return { start, end }
  const total = Math.min(minutes(start) + 60, 23 * 60 + 59)
  return { start, end: { hour: Math.floor(total / 60), minute: total % 60 } }
}

export function parseQuickAdd(input: string, base: LocalDate): QuickDraft | null {
  let text = ` ${input.trim()} `
  let time: QuickDraft["time"]

  const range = RANGE.exec(text)
  if (range) {
    const start = { hour: Number(range[1]), minute: Number(range[2]) }
    const end = range[3] ? { hour: Number(range[3]), minute: Number(range[4]) } : null
    time = span(start, end)
    text = text.replace(range[0], " ")
  } else {
    const m = MERIDIEM_RANGE.exec(text)
    const end = m ? from12(Number(m[4]), Number(m[5] ?? 0), m[6]!) : null
    const start = m && end ? from12(Number(m[1]), Number(m[2] ?? 0), m[3] ?? m[6]!) : null
    if (m && start && end) {
      time = span(start, end)
      text = text.replace(m[0], " ")
    }
  }

  // The date (and a single "3pm" / "at 5" when no range was found).
  const when = parseWhen(text, base)
  if (!time && when.time) time = span(when.time, null)
  const title = when.rest.replace(/\s+(on|at)$/i, "").trim()
  if (!title) return null
  return { title: title.slice(0, 200), date: when.date ?? base, time }
}
