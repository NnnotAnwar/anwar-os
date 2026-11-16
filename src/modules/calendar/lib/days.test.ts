import { describe, expect, it } from "vitest"
import { addMonths, groupByDay, monthGrid, occurrenceDates, startOfWeek } from "./days"

const PRAGUE = "Europe/Prague"

describe("occurrenceDates", () => {
  it("places a timed event on its local day", () => {
    // 23:30 UTC on 15 Nov is 00:30 on 16 Nov in Prague.
    expect(occurrenceDates({ start: "2026-11-15T23:30:00Z", end: "2026-11-16T00:30:00Z", allDay: false }, PRAGUE)).toEqual([
      "2026-11-16",
    ])
  })

  it("doesn't spill an event ending at midnight into the next day", () => {
    expect(occurrenceDates({ start: "2026-11-16T21:00:00Z", end: "2026-11-16T23:00:00Z", allDay: false }, PRAGUE)).toEqual([
      "2026-11-16",
    ])
  })

  it("covers every day of a multi-day all-day event, end exclusive", () => {
    expect(occurrenceDates({ start: "2026-11-16T00:00:00Z", end: "2026-11-19T00:00:00Z", allDay: true }, PRAGUE)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ])
  })

  it("groups occurrences by day", () => {
    const o = { key: "a", eventId: "a", title: "A", location: "", category: "work" as const, start: "2026-11-16T08:00:00Z", end: "2026-11-17T08:00:00Z", allDay: false, timezone: PRAGUE, recurring: false }
    const map = groupByDay([o], PRAGUE)
    expect([...map.keys()]).toEqual(["2026-11-16", "2026-11-17"])
  })
})

describe("grid helpers", () => {
  it("starts weeks on Monday and builds a 6-week month grid", () => {
    expect(startOfWeek({ year: 2026, month: 11, day: 22 })).toEqual({ year: 2026, month: 11, day: 16 })
    const grid = monthGrid({ year: 2026, month: 11, day: 16 })
    expect(grid).toHaveLength(42)
    expect(grid[0]).toEqual({ year: 2026, month: 10, day: 26 })
  })

  it("adds months, clamping the day", () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28 })
    expect(addMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({ year: 2025, month: 12, day: 15 })
  })
})
