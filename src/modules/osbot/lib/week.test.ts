import { describe, expect, it } from "vitest"
import { isMonday, isoWeekday, shiftWeek, weekLabel, weekOf } from "./week"

describe("weeks for the weekly review", () => {
  it("runs Monday to Sunday", () => {
    expect(isoWeekday("2026-11-16")).toBe(1)
    expect(isoWeekday("2026-11-22")).toBe(7)
    expect(weekOf("2026-11-22")).toEqual({ start: "2026-11-16", end: "2026-11-22" })
    expect(weekOf("2026-11-16")).toEqual({ start: "2026-11-16", end: "2026-11-22" })
    expect(weekOf("2026-11-19")).toEqual({ start: "2026-11-16", end: "2026-11-22" })
  })

  it("crosses months and years", () => {
    expect(weekOf("2026-12-02")).toEqual({ start: "2026-11-30", end: "2026-12-06" })
    expect(shiftWeek(weekOf("2026-12-28"), 1)).toEqual({ start: "2027-01-04", end: "2027-01-10" })
    expect(shiftWeek(weekOf("2026-11-22"), -1)).toEqual({ start: "2026-11-09", end: "2026-11-15" })
  })

  it("labels a week compactly", () => {
    expect(weekLabel({ start: "2026-11-16", end: "2026-11-22" })).toBe("16–22 Nov")
    expect(weekLabel({ start: "2026-11-30", end: "2026-12-06" })).toBe("30 Nov – 6 Dec")
    expect(weekLabel({ start: "2026-12-28", end: "2027-01-03" })).toBe("28 Dec 2026 – 3 Jan 2027")
  })

  it("knows a Monday", () => {
    expect(isMonday("2026-11-23")).toBe(true)
    expect(isMonday("2026-11-24")).toBe(false)
    expect(isMonday("2026-02-30")).toBe(false)
  })
})
