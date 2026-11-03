import { describe, expect, it } from "vitest"
import {
  calendarDate,
  daysLeftInYear,
  formatRelative,
  isoWeek,
  isoWeekRange,
  isoWeeksInYear,
} from "./time"

describe("calendarDate", () => {
  it("uses the viewer's timezone, not UTC", () => {
    // 23:30 UTC on Nov 2 is already Nov 3 in Prague (UTC+1 in winter).
    const instant = new Date("2026-11-02T23:30:00Z")
    expect(calendarDate(instant, "Europe/Prague")).toEqual({
      year: 2026,
      month: 11,
      day: 3,
      weekday: 2,
    })
    expect(calendarDate(instant, "UTC").day).toBe(2)
  })
})

describe("ISO weeks", () => {
  it("numbers weeks per ISO-8601", () => {
    expect(isoWeek({ year: 2026, month: 11, day: 3 })).toEqual({ week: 45, weekYear: 2026 })
    expect(isoWeek({ year: 2026, month: 1, day: 1 })).toEqual({ week: 1, weekYear: 2026 })
    // Jan 1 2027 is a Friday, so it still belongs to 2026's last week.
    expect(isoWeek({ year: 2027, month: 1, day: 1 })).toEqual({ week: 53, weekYear: 2026 })
  })

  it("knows which years have 53 weeks", () => {
    expect(isoWeeksInYear(2026)).toBe(53)
    expect(isoWeeksInYear(2027)).toBe(52)
  })

  it("returns Monday–Sunday ranges", () => {
    const { start, end } = isoWeekRange(2026, 45)
    expect(start.toISOString().slice(0, 10)).toBe("2026-11-02")
    expect(end.toISOString().slice(0, 10)).toBe("2026-11-08")
  })
})

describe("daysLeftInYear", () => {
  it("counts days until Dec 31", () => {
    expect(daysLeftInYear({ year: 2026, month: 11, day: 3 })).toBe(58)
    expect(daysLeftInYear({ year: 2026, month: 12, day: 31 })).toBe(0)
  })
})

describe("formatRelative", () => {
  const now = new Date("2026-11-03T12:00:00Z")
  it("formats short relative times", () => {
    expect(formatRelative(new Date("2026-11-03T11:55:00Z"), now, "en")).toBe("5 min. ago")
    expect(formatRelative(new Date("2026-11-02T12:00:00Z"), now, "en")).toBe("yesterday")
    expect(formatRelative(new Date("2026-11-03T11:59:40Z"), now, "en")).toBe("just now")
  })
})
