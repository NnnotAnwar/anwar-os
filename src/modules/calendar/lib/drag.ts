// Moving and resizing events in the week view. Pure, so the snapping is tested.
import { addDays, formatIsoDate, formatTime, wallClock, zonedToUtc, type LocalDate } from "./zoned"

export const SNAP_MIN = 15
export const MIN_LENGTH = 15
const DAY_MIN = 24 * 60

export function snap(minutes: number, step = SNAP_MIN) {
  return Math.round(minutes / step) * step
}

/** Where a tap at `y` px into the day lands: the half hour it falls in. */
export function slotAt(y: number, hourPx: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(DAY_MIN - 30, Math.floor((y / hourPx) * 2) * 30))
  return { start, end: Math.min(start + 60, DAY_MIN - 1) }
}

export type Span = { day: number; start: number; end: number }

/**
 * The event's new place after a drag. `mode` move shifts both ends and may
 * change the day; resize only moves the end. Times snap to 15 minutes and
 * stay inside the day, and an event never gets shorter than 15 minutes.
 */
export function dragSpan(
  from: Span,
  delta: { minutes: number; days: number },
  mode: "move" | "resize",
  days = 7,
): Span {
  if (mode === "resize") {
    const end = Math.min(DAY_MIN, Math.max(from.start + MIN_LENGTH, snap(from.end + delta.minutes)))
    return { ...from, end }
  }
  const length = from.end - from.start
  const start = Math.min(DAY_MIN - length, Math.max(0, snap(from.start + delta.minutes)))
  const day = Math.min(days - 1, Math.max(0, from.day + delta.days))
  return { day, start, end: start + length }
}

/**
 * Turns a span in the viewer's week back into the editor's fields, in the
 * event's own time zone (they can differ when travelling).
 */
export function spanToFields(
  span: Span,
  weekStart: LocalDate,
  viewerZone: string,
  eventZone: string,
): { startDate: string; startTime: string; endDate: string; endTime: string } {
  const date = addDays(weekStart, span.day)
  const at = (minutes: number) => {
    const extraDays = Math.floor(minutes / DAY_MIN)
    const m = minutes - extraDays * DAY_MIN
    const d = addDays(date, extraDays)
    const instant = zonedToUtc({ ...d, hour: Math.floor(m / 60), minute: m % 60 }, viewerZone)
    return wallClock(instant, eventZone)
  }
  const s = at(span.start)
  const e = at(span.end)
  return { startDate: formatIsoDate(s), startTime: formatTime(s), endDate: formatIsoDate(e), endTime: formatTime(e) }
}
