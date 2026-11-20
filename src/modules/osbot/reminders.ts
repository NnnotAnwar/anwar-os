// Which calendar reminders are due, as notifications for osbot. Pure: the
// route loads events, reminders and past deliveries, this decides. Recurring
// events are expanded with the calendar's own expandEvent().
//
// A notification is due when `occurrence anchor − minutesBefore` falls in
// (until − lookback, until] and it was not delivered yet. The anchor is the
// occurrence start; for all-day events, local midnight of its date in the
// owner's zone (what calendar apps do with all-day alarms). Occurrences that
// have already ended are skipped. When several reminders of one occurrence are
// due at once (the bot was down), they collapse into one notification whose
// `keys` the bot acknowledges together.

import { formatClock, formatDayMonth, formatWeekdayShort } from "@/modules/calendar/lib/format"
import { expandEvent } from "@/modules/calendar/lib/recurrence"
import { startOfLocalDay, utcDate, wallClock } from "@/modules/calendar/lib/zoned"

export type ReminderEvent = {
  id: string
  title: string
  location: string
  startAt: Date
  endAt: Date
  allDay: boolean
  timezone: string
  rrule: string | null
}

export type ReminderRow = { eventId: string; minutesBefore: number }

export type DueReminder = {
  /** Delivery keys to acknowledge after sending (one per collapsed reminder). */
  keys: string[]
  eventId: string
  title: string
  location: string
  allDay: boolean
  /** Occurrence start (the anchor for all-day events), ISO. */
  start: string
  end: string
  /** The reminder that triggered this notification (the latest one due). */
  minutesBefore: number
  dueAt: string
  /** "14:00", "Tue 17 Nov · 14:00" when it isn't on the day the reminder fires, "Tue 17 Nov" for all-day. */
  when: string
}

export const MAX_LOOKBACK_MINUTES = 24 * 60
export const DEFAULT_LOOKBACK_MINUTES = 6 * 60

/** "<event id>:<occurrence start ISO>:<minutes before>", the idempotency key. */
export function deliveryKey(eventId: string, occurrenceStart: Date | string, minutesBefore: number) {
  const iso = typeof occurrenceStart === "string" ? new Date(occurrenceStart).toISOString() : occurrenceStart.toISOString()
  return `${eventId}:${iso}:${minutesBefore}`
}

const KEY = /^([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):(\d{1,5})$/

export function parseDeliveryKey(key: string): { eventId: string; occurrenceStart: Date; minutesBefore: number } | null {
  const m = KEY.exec(key)
  if (!m) return null
  const occurrenceStart = new Date(m[2]!)
  const minutesBefore = Number(m[3])
  if (Number.isNaN(occurrenceStart.getTime()) || minutesBefore > 40320) return null
  return { eventId: m[1]!, occurrenceStart, minutesBefore }
}

function dayLabel(instant: Date, timeZone: string) {
  return `${formatWeekdayShort(instant, "en", timeZone)} ${formatDayMonth(instant, "en", timeZone)}`
}

export type PlanInput = {
  events: ReminderEvent[]
  reminders: ReminderRow[]
  /** Keys already delivered (deliveryKey format). */
  delivered: ReadonlySet<string>
  ownerTimezone: string
  until: Date
  now: Date
  lookbackMinutes?: number
}

export function dueReminders(input: PlanInput): DueReminder[] {
  const { events, reminders, delivered, ownerTimezone: tz, until, now } = input
  const lookback = Math.min(Math.max(input.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES, 1), MAX_LOOKBACK_MINUTES)
  const from = new Date(until.getTime() - lookback * 60_000)

  const byEvent = new Map<string, number[]>()
  for (const r of reminders) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r.minutesBefore])

  const out: DueReminder[] = []
  for (const event of events) {
    const minutes = [...new Set(byEvent.get(event.id) ?? [])].sort((a, b) => a - b)
    if (!minutes.length) continue
    const longest = minutes.at(-1)!
    // Occurrences whose anchor could put a reminder in (from, until]; a day of
    // slack on both sides covers all-day anchors shifted by the owner's offset.
    const windowStart = new Date(from.getTime() - 86_400_000)
    const windowEnd = new Date(until.getTime() + longest * 60_000 + 86_400_000)
    for (const instance of expandEvent(
      { start: event.startAt, end: event.endAt, allDay: event.allDay, timezone: event.timezone, rrule: event.rrule },
      windowStart,
      windowEnd,
    )) {
      const anchor = event.allDay ? startOfLocalDay(utcDate(instance.start), tz) : instance.start
      const anchorEnd = event.allDay ? startOfLocalDay(utcDate(instance.end), tz) : instance.end
      // Over already: nothing left to remind about (a zero-length event is over once it starts).
      if (anchorEnd > anchor ? anchorEnd <= now : anchor < now) continue

      const due = minutes
        .map((m) => ({ m, at: new Date(anchor.getTime() - m * 60_000), key: deliveryKey(event.id, instance.start, m) }))
        .filter((d) => d.at > from && d.at <= until && !delivered.has(d.key))
      if (!due.length) continue

      // Smallest minutes = the most recent reminder; it speaks for the rest.
      const latest = due[0]!
      const fireDay = wallClock(latest.at, tz)
      const startDay = wallClock(anchor, tz)
      const sameDay = fireDay.year === startDay.year && fireDay.month === startDay.month && fireDay.day === startDay.day
      const when = event.allDay
        ? dayLabel(anchor, tz)
        : sameDay
          ? formatClock(anchor, tz)
          : `${dayLabel(anchor, tz)} · ${formatClock(anchor, tz)}`

      out.push({
        keys: due.map((d) => d.key),
        eventId: event.id,
        title: event.title,
        location: event.location,
        allDay: event.allDay,
        start: anchor.toISOString(),
        end: anchorEnd.toISOString(),
        minutesBefore: latest.m,
        dueAt: latest.at.toISOString(),
        when,
      })
    }
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.title.localeCompare(b.title))
}
