// When a daily scheduled message (the morning brief, the evening journal
// question) is due, in the owner's time zone. Pure, so the windows can be
// tested across midnight and daylight-saving changes.
//
// A message is due from its time until CUTOFF_MINUTES later. After that it is
// skipped for the day rather than sent late: if osbot was down at 08:00 and
// comes back at 12:00, no "good morning" arrives at lunch. The window is
// measured in real time from the scheduled instant, so a DST change inside it
// neither shortens nor stretches it, and a window that crosses midnight still
// belongs to the day it started on (that day is the delivery key).

import { addDays, formatIsoDate, parseTime, wallClock, zonedToUtc } from "@/modules/calendar/lib/zoned"

/** How long after its time a daily message may still go out (the bot was down, the app was deploying). */
export const CUTOFF_MINUTES = 180

const MINUTE = 60_000

export type Slot = {
  /** The owner's day the message belongs to (YYYY-MM-DD): its delivery key. */
  date: string
  /** When it is scheduled on that day. */
  at: Date
  /** before: not yet today; due: send now (unless sent); missed: past the cut-off, skipped. */
  state: "before" | "due" | "missed"
}

/**
 * The slot `now` falls into for a message scheduled daily at `time` (HH:MM,
 * the owner's clock in `timeZone`). Yesterday's slot still counts while its
 * window, which may run past midnight, is open. A time skipped by a
 * spring-forward gap moves forward by the gap (02:30 → 03:30); an ambiguous
 * autumn time is its first occurrence (zonedToUtc).
 */
export function dailySlot(now: Date, timeZone: string, time: string, cutoffMinutes = CUTOFF_MINUTES): Slot {
  const clock = parseTime(time)
  if (!clock) throw new Error(`Not a time: ${time}`)
  const local = wallClock(now, timeZone)
  const today = { year: local.year, month: local.month, day: local.day }
  const slotOn = (offset: number) => {
    const day = addDays(today, offset)
    return { date: formatIsoDate(day), at: zonedToUtc({ ...day, ...clock }, timeZone) }
  }
  const t = now.getTime()
  const window = cutoffMinutes * MINUTE
  const yesterday = slotOn(-1)
  if (t >= yesterday.at.getTime() && t < yesterday.at.getTime() + window) return { ...yesterday, state: "due" }
  const current = slotOn(0)
  if (t < current.at.getTime()) return { ...current, state: "before" }
  return { ...current, state: t < current.at.getTime() + window ? "due" : "missed" }
}

/** The owner's day and clock time ("2026-11-25", "08:05"). */
export function ownerClock(now: Date, timeZone: string) {
  const w = wallClock(now, timeZone)
  return {
    today: formatIsoDate({ year: w.year, month: w.month, day: w.day }),
    time: `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`,
  }
}
