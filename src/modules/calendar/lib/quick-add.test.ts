import { describe, expect, it } from "vitest"
import { parseQuickAdd } from "./quick-add"

// Monday 16 Nov 2026.
const base = { year: 2026, month: 11, day: 16 }

describe("parseQuickAdd", () => {
  it("treats plain text as an all-day event on the given day", () => {
    expect(parseQuickAdd("Pay rent", base)).toEqual({ title: "Pay rent", date: base, time: undefined })
  })

  it("reads a time and defaults to one hour", () => {
    expect(parseQuickAdd("Dentist 14:00", base)).toEqual({
      title: "Dentist",
      date: base,
      time: { start: { hour: 14, minute: 0 }, end: { hour: 15, minute: 0 } },
    })
  })

  it("reads a time range and 'at'", () => {
    expect(parseQuickAdd("Gym at 7:30-8:45", base)?.time).toEqual({
      start: { hour: 7, minute: 30 },
      end: { hour: 8, minute: 45 },
    })
  })

  it("reads today, tomorrow and weekday names", () => {
    expect(parseQuickAdd("Call mom tomorrow", base)?.date).toEqual({ year: 2026, month: 11, day: 17 })
    expect(parseQuickAdd("Lunch fri 12:30", base)?.date).toEqual({ year: 2026, month: 11, day: 20 })
    // Today's weekday means next week.
    expect(parseQuickAdd("Review monday", base)?.date).toEqual({ year: 2026, month: 11, day: 23 })
    expect(parseQuickAdd("Standup today 9:00", base)?.title).toBe("Standup")
  })

  it("caps a late default end at 23:59 and ignores an end before the start", () => {
    expect(parseQuickAdd("Late 23:30", base)?.time?.end).toEqual({ hour: 23, minute: 59 })
    expect(parseQuickAdd("Odd 10:00-09:00", base)?.time?.end).toEqual({ hour: 11, minute: 0 })
  })

  it("returns null without a title", () => {
    expect(parseQuickAdd("  tomorrow 10:00 ", base)).toBeNull()
  })
})
