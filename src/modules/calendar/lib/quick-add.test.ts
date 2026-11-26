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

  it("reads dates the way task quick add does, counted from the picked day", () => {
    const at = (text: string) => parseQuickAdd(text, base)
    expect(at("Flight 31.12. 6:00")).toEqual({
      title: "Flight",
      date: { year: 2026, month: 12, day: 31 },
      time: { start: { hour: 6, minute: 0 }, end: { hour: 7, minute: 0 } },
    })
    expect(at("Meeting 31 dec")).toEqual({ title: "Meeting", date: { year: 2026, month: 12, day: 31 }, time: undefined })
    expect(at("Trip 2026-12-24")?.date).toEqual({ year: 2026, month: 12, day: 24 })
    expect(at("Party 31/12 22:00")?.date).toEqual({ year: 2026, month: 12, day: 31 })
    expect(at("zítra 10:00 schůzka")).toMatchObject({ title: "schůzka", date: { year: 2026, month: 11, day: 17 } })
    expect(at("Exam in 3 days")?.date).toEqual({ year: 2026, month: 11, day: 19 })
    // "next" goes with the weekday, not into the title.
    expect(at("Standup next friday 10:00")).toMatchObject({ title: "Standup", date: { year: 2026, month: 11, day: 20 } })
  })

  it("reads am/pm times and ranges", () => {
    expect(parseQuickAdd("Call 9am", base)?.time).toEqual({ start: { hour: 9, minute: 0 }, end: { hour: 10, minute: 0 } })
    expect(parseQuickAdd("Gym 7pm-8pm", base)?.time).toEqual({ start: { hour: 19, minute: 0 }, end: { hour: 20, minute: 0 } })
    expect(parseQuickAdd("Gym 7-8:30pm", base)).toEqual({
      title: "Gym",
      date: base,
      time: { start: { hour: 19, minute: 0 }, end: { hour: 20, minute: 30 } },
    })
  })

  it("keeps what isn't a date or a time in the title", () => {
    expect(parseQuickAdd("Feb 30 party", base)).toEqual({ title: "Feb 30 party", date: base, time: undefined })
    expect(parseQuickAdd("Read chapters 3-5", base)?.title).toBe("Read chapters 3-5")
  })

  it("returns null without a title", () => {
    expect(parseQuickAdd("  tomorrow 10:00 ", base)).toBeNull()
  })
})
