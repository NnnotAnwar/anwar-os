import { describe, expect, it } from "vitest"
import { addMonthsIso, formatMonth, monthRange, monthsBetween, parseDate, shiftMonth, todayIn } from "./dates"

describe("parseDate", () => {
  it("reads Czech dates", () => {
    expect(parseDate("16.11.2026")).toBe("2026-11-16")
    expect(parseDate("16. 11. 2026")).toBe("2026-11-16")
    expect(parseDate("1.2.2026")).toBe("2026-02-01")
    expect(parseDate("16.11.26")).toBe("2026-11-16")
    expect(parseDate("16.11.2026 14:05")).toBe("2026-11-16")
  })

  it("reads ISO and slash dates, day first", () => {
    expect(parseDate("2026-11-16")).toBe("2026-11-16")
    expect(parseDate("2026-11-16T10:00:00Z")).toBe("2026-11-16")
    expect(parseDate("16/11/2026")).toBe("2026-11-16")
    expect(parseDate("03/04/2026")).toBe("2026-04-03")
    // 13 can't be a month, so this one must be month-first.
    expect(parseDate("11/13/2026")).toBe("2026-11-13")
  })

  it("fills the year for day.month. when today is known", () => {
    expect(parseDate("16.11.", "2026-12-01")).toBe("2026-11-16")
    expect(parseDate("16.11.")).toBeNull()
  })

  it("rejects impossible dates and noise", () => {
    for (const bad of ["31.2.2026", "2026-13-01", "32.1.2026", "16.11", "yesterday", "", "250"]) {
      expect(parseDate(bad), bad).toBeNull()
    }
    expect(parseDate("29.2.2028")).toBe("2028-02-29")
  })
})

describe("months", () => {
  it("clamps month arithmetic to the anchor day", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonthsIso("2026-02-28", 1, 31)).toBe("2026-03-31")
    expect(addMonthsIso("2026-11-15", -12)).toBe("2025-11-15")
  })

  it("gives ranges, shifts and distances", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
    expect(monthsBetween("2025-11", "2026-02")).toBe(3)
    expect(formatMonth("2026-11", "en")).toBe("November 2026")
  })

  it("knows today in the viewer's zone", () => {
    // 23:30 UTC on Nov 16 is already Nov 17 in Prague.
    expect(todayIn("Europe/Prague", new Date("2026-11-16T23:30:00Z"))).toBe("2026-11-17")
    expect(todayIn("UTC", new Date("2026-11-16T23:30:00Z"))).toBe("2026-11-16")
  })
})
