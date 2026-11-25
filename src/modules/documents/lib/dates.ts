// ISO day helpers ("2026-12-24"), computed at UTC so a day never shifts, and
// the owner's wall clock for "today" and "now". Pure; client-safe.

import { formatIsoDate, formatTime, wallClock } from "@/modules/calendar/lib/zoned"

const DAY = 86_400_000
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

const at = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** True for a real calendar day written as YYYY-MM-DD. */
export function isIsoDay(value: string) {
  const m = ISO.exec(value)
  if (!m) return false
  const d = at(value)
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3])
}

export function addDaysIso(iso: string, days: number) {
  return new Date(at(iso).getTime() + days * DAY).toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string) {
  return Math.round((at(b).getTime() - at(a).getTime()) / DAY)
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const shortFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

/** "24 Dec 2026". */
export function formatDate(iso: string) {
  return dateFormat.format(at(iso))
}

/** "24 Dec". */
export function formatShortDate(iso: string) {
  return shortFormat.format(at(iso))
}

/** The owner's calendar day and clock ("2026-11-25", "10:00") at `now`. */
export function ownerClock(timezone: string, now: Date) {
  const w = wallClock(now, timezone)
  return { today: formatIsoDate({ year: w.year, month: w.month, day: w.day }), time: formatTime(w) }
}
