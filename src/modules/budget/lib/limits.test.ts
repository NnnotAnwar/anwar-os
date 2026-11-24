import { describe, expect, it } from "vitest"
import { limitAlertKey, limitStatus, monthPace, percentUsed, reachedThresholds } from "./limits"

describe("limitStatus", () => {
  it("is ok under 90 %, near from 90 % and over at the limit", () => {
    expect(limitStatus(0, 600000)).toBe("ok")
    expect(limitStatus(539999, 600000)).toBe("ok")
    expect(limitStatus(540000, 600000)).toBe("near")
    expect(limitStatus(599999, 600000)).toBe("near")
    expect(limitStatus(600000, 600000)).toBe("over")
    expect(limitStatus(900000, 600000)).toBe("over")
  })

  it("treats a missing limit as ok", () => {
    expect(limitStatus(100, 0)).toBe("ok")
  })
})

describe("reachedThresholds", () => {
  it("lists the thresholds reached, lowest first", () => {
    expect(reachedThresholds(100, 1000)).toEqual([])
    expect(reachedThresholds(900, 1000)).toEqual([90])
    expect(reachedThresholds(1000, 1000)).toEqual([90, 100])
    // One big expense jumps straight past both.
    expect(reachedThresholds(5000, 1000)).toEqual([90, 100])
  })

  it("never fires without a limit", () => {
    expect(reachedThresholds(5000, 0)).toEqual([])
  })
})

describe("percentUsed", () => {
  it("floors, so 99.9 % isn't shown as 100 %", () => {
    expect(percentUsed(999, 1000)).toBe(99)
    expect(percentUsed(1000, 1000)).toBe(100)
    expect(percentUsed(1, 3)).toBe(33)
  })

  it("caps huge overruns for display", () => {
    expect(percentUsed(10_000_000, 1)).toBe(999)
  })
})

describe("monthPace", () => {
  it("projects the month-end total from the days gone", () => {
    // 10 days of November (30 days) gone, 3 000 spent → 9 000.
    expect(monthPace(300000, "2026-11", "2026-11-10")).toBe(900000)
    // February 2028 has 29 days.
    expect(monthPace(100000, "2028-02", "2028-02-10")).toBe(290000)
  })

  it("says nothing for another month or the first two days", () => {
    expect(monthPace(300000, "2026-10", "2026-11-10")).toBeNull()
    expect(monthPace(300000, "2026-11", "2026-11-02")).toBeNull()
  })
})

it("keys an alert by category, month and threshold", () => {
  expect(limitAlertKey("6a1c0d2e-0000-4000-8000-000000000001", "2026-11", 90)).toBe("6a1c0d2e-0000-4000-8000-000000000001:2026-11:90")
})
