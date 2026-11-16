// "Dentist tomorrow 14:00" → a draft event. Deliberately small: a time or
// time range, and today / tomorrow / a weekday name. Everything else is title.

import { addDays, weekdayOf, type LocalDate } from "./zoned"

export type QuickDraft = {
  title: string
  date: LocalDate
  /** Absent for an all-day event. */
  time?: { start: { hour: number; minute: number }; end: { hour: number; minute: number } }
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const TIME = String.raw`([01]?\d|2[0-3])[:.]([0-5]\d)`
const RANGE = new RegExp(String.raw`(?:^|\s)(?:at\s+)?${TIME}(?:\s*[-–]\s*${TIME})?(?=\s|$)`, "i")

export function parseQuickAdd(input: string, base: LocalDate): QuickDraft | null {
  let text = ` ${input.trim()} `
  let date = base
  let time: QuickDraft["time"]

  const range = RANGE.exec(text)
  if (range) {
    const start = { hour: Number(range[1]), minute: Number(range[2]) }
    let end = range[3] ? { hour: Number(range[3]), minute: Number(range[4]) } : null
    if (!end || end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
      // Default to one hour, capped at the end of the day.
      const total = Math.min(start.hour * 60 + start.minute + 60, 23 * 60 + 59)
      end = { hour: Math.floor(total / 60), minute: total % 60 }
    }
    time = { start, end }
    text = text.replace(range[0], " ")
  }

  const words = text.split(/\s+/).filter(Boolean)
  const kept: string[] = []
  let dated = false
  for (const word of words) {
    const lower = word.toLowerCase()
    if (!dated && lower === "today") {
      dated = true
    } else if (!dated && lower === "tomorrow") {
      date = addDays(base, 1)
      dated = true
    } else if (!dated && WEEKDAYS.some((d) => d === lower || d.slice(0, 3) === lower)) {
      const target = WEEKDAYS.findIndex((d) => d === lower || d.slice(0, 3) === lower) + 1
      // The next such day; today's weekday means a week from today.
      const ahead = (target - weekdayOf(base) + 7) % 7 || 7
      date = addDays(base, ahead)
      dated = true
    } else {
      kept.push(word)
    }
  }

  const title = kept.join(" ").replace(/\s+(on|at)$/i, "").trim()
  if (!title) return null
  return { title: title.slice(0, 200), date, time }
}
