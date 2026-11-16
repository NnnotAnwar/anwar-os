// Inputs and shared types for the calendar. Client-safe: no server imports.
import { z } from "zod"
import { calendarCategories, type CalendarCategory } from "./lib/categories"
import { formatRRule, frequencies, parseRRule, type Recurrence, type Weekday } from "./lib/recurrence"
import {
  addDays,
  formatIsoDate,
  formatTime,
  isValidTimeZone,
  parseIsoDate,
  parseTime,
  utcDate,
  utcMidnight,
  wallClock,
  weekdayOf,
  zonedToUtc,
  type LocalDate,
} from "./lib/zoned"

export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080] as const

const isoDate = z.string().refine((v) => parseIsoDate(v) !== null, "Pick a valid date.")
const clock = z.string().refine((v) => parseTime(v) !== null, "Use a 24-hour time like 09:30.")

export const repeatInput = z.object({
  freq: z.enum(frequencies),
  interval: z.number().int().min(1, "Repeat at least every 1.").max(99, "Keep the interval under 100."),
  byWeekday: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  ends: z.discriminatedUnion("type", [
    z.object({ type: z.literal("never") }),
    z.object({ type: z.literal("until"), date: isoDate }),
    z.object({ type: z.literal("count"), count: z.number().int().min(1).max(999) }),
  ]),
})
export type RepeatInput = z.infer<typeof repeatInput>

export const eventFields = z.object({
  title: z.string().trim().min(1, "Give the event a title.").max(200, "Keep the title under 200 characters."),
  notes: z.string().max(10_000, "Notes are too long.").default(""),
  location: z.string().trim().max(300, "Keep the location under 300 characters.").default(""),
  category: z.enum(calendarCategories).default("personal"),
  allDay: z.boolean(),
  startDate: isoDate,
  startTime: clock.optional(),
  endDate: isoDate,
  endTime: clock.optional(),
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone."),
  repeat: repeatInput.nullable().default(null),
  reminders: z
    .array(z.number().int().min(0).max(40_320))
    .max(5, "Five reminders at most.")
    .default([]),
})
export type EventFields = z.infer<typeof eventFields>

export const createEventInput = eventFields
export const updateEventInput = eventFields.extend({ id: z.uuid() })
export const eventIdInput = z.object({ id: z.uuid() })
export const rangeInput = z.object({ from: z.date(), to: z.date() })
export const searchEventsInput = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(10),
})

/** The database shape an editor submission turns into. */
export type EventRow = {
  title: string
  notes: string
  location: string
  category: CalendarCategory
  startAt: Date
  endAt: Date
  allDay: boolean
  timezone: string
  rrule: string | null
}

export class EventInputError extends Error {}

/**
 * Editor fields → row. Timed events are read as wall-clock times in their
 * zone; all-day events become UTC midnights with an exclusive end. Weekly
 * repeats always include the start's weekday, so the first instance is the
 * event itself.
 */
export function toEventRow(fields: EventFields): EventRow {
  const startDate = parseIsoDate(fields.startDate)!
  const endDate = parseIsoDate(fields.endDate)!
  let startAt: Date
  let endAt: Date

  if (fields.allDay) {
    startAt = utcMidnight(startDate)
    endAt = utcMidnight(addDays(endDate, 1))
    if (endAt <= startAt) throw new EventInputError("The event can't end before it starts.")
  } else {
    const startTime = parseTime(fields.startTime) ?? { hour: 9, minute: 0 }
    const endTime = parseTime(fields.endTime) ?? startTime
    startAt = zonedToUtc({ ...startDate, ...startTime }, fields.timezone)
    endAt = zonedToUtc({ ...endDate, ...endTime }, fields.timezone)
    if (endAt < startAt) throw new EventInputError("The event can't end before it starts.")
  }

  let rrule: string | null = null
  if (fields.repeat) {
    const { freq, interval, ends } = fields.repeat
    const rule: Recurrence = { freq, interval }
    if (freq === "weekly") {
      const days = new Set<number>(fields.repeat.byWeekday ?? [])
      days.add(weekdayOf(startDate))
      rule.byWeekday = [...days].sort((a, b) => a - b) as Weekday[]
    }
    if (ends.type === "count") rule.count = ends.count
    if (ends.type === "until") {
      const until = parseIsoDate(ends.date)!
      if (until.year * 10_000 + until.month * 100 + until.day < startDate.year * 10_000 + startDate.month * 100 + startDate.day) {
        throw new EventInputError("The repeat can't end before the event starts.")
      }
      // Inclusive: anything starting on the until-date still counts.
      rule.until = fields.allDay
        ? utcMidnight(until)
        : new Date(zonedToUtc({ ...addDays(until, 1), hour: 0, minute: 0 }, fields.timezone).getTime() - 1000)
    }
    rrule = formatRRule(rule, fields.allDay)
  }

  return {
    title: fields.title,
    notes: fields.notes,
    location: fields.location,
    category: fields.category,
    startAt,
    endAt,
    allDay: fields.allDay,
    timezone: fields.timezone,
    rrule,
  }
}

/** Row → editor fields (the inverse of toEventRow). */
export function toEventFields(row: EventRow & { reminders: number[] }): EventFields {
  const rule = parseRRule(row.rrule)
  let startDate: LocalDate
  let endDate: LocalDate
  let startTime: string | undefined
  let endTime: string | undefined
  if (row.allDay) {
    startDate = utcDate(row.startAt)
    endDate = addDays(utcDate(row.endAt), -1)
    if (endDate.year * 10_000 + endDate.month * 100 + endDate.day < startDate.year * 10_000 + startDate.month * 100 + startDate.day) {
      endDate = startDate
    }
  } else {
    const s = wallClock(row.startAt, row.timezone)
    const e = wallClock(row.endAt, row.timezone)
    startDate = s
    endDate = e
    startTime = formatTime(s)
    endTime = formatTime(e)
  }

  let repeat: RepeatInput | null = null
  if (rule) {
    let ends: RepeatInput["ends"] = { type: "never" }
    if (rule.count) ends = { type: "count", count: rule.count }
    else if (rule.until) {
      ends = { type: "until", date: formatIsoDate(row.allDay ? utcDate(rule.until) : wallClock(rule.until, row.timezone)) }
    }
    repeat = { freq: rule.freq, interval: rule.interval, byWeekday: rule.byWeekday, ends }
  }

  return {
    title: row.title,
    notes: row.notes,
    location: row.location,
    category: row.category,
    allDay: row.allDay,
    startDate: formatIsoDate(startDate),
    startTime,
    endDate: formatIsoDate(endDate),
    endTime,
    timezone: row.timezone,
    repeat,
    reminders: [...row.reminders].sort((a, b) => a - b),
  }
}

/** One expanded instance, serializable for client components. */
export type Occurrence = {
  /** eventId + start, unique per instance. */
  key: string
  eventId: string
  title: string
  location: string
  category: CalendarCategory
  start: string
  end: string
  allDay: boolean
  timezone: string
  recurring: boolean
}

export type EventDetail = EventFields & { id: string; recurrenceText: string | null }

export type FeedInfo = { url: string; createdAt: string } | null

/** "1 day before", "15 min before", "At start". */
export function reminderLabel(minutes: number) {
  if (minutes === 0) return "At start"
  if (minutes % 10080 === 0) return `${minutes / 10080} ${minutes === 10080 ? "week" : "weeks"} before`
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "day" : "days"} before`
  if (minutes % 60 === 0) return `${minutes / 60} h before`
  return `${minutes} min before`
}
