import { describe, expect, it } from "vitest"
import { describeRule, dueDates, nextOnOrAfter, occurrence, type RecurringRule } from "./recurring"

const rule = (r: Partial<RecurringRule>): RecurringRule => ({
  freq: "monthly",
  interval: 1,
  startOn: "2026-01-31",
  endOn: null,
  ...r,
})

describe("occurrence", () => {
  it("keeps month-end rents on the last day and returns to the 31st", () => {
    const r = rule({})
    expect([0, 1, 2, 3].map((k) => occurrence(r, k))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
  })

  it("steps weeks and years", () => {
    expect(occurrence(rule({ freq: "weekly", interval: 2, startOn: "2026-11-02" }), 3)).toBe("2026-12-14")
    expect(occurrence(rule({ freq: "yearly", startOn: "2028-02-29" }), 1)).toBe("2029-02-28")
    expect(occurrence(rule({ freq: "yearly", startOn: "2028-02-29" }), 4)).toBe("2032-02-29")
  })
})

describe("dueDates", () => {
  it("returns every missed occurrence up to today and where to continue", () => {
    const r = rule({ startOn: "2026-09-15" })
    expect(dueDates(r, "2026-09-15", "2026-11-16")).toEqual({
      dates: ["2026-09-15", "2026-10-15", "2026-11-15"],
      nextDue: "2026-12-15",
    })
  })

  it("is idempotent: running again from the new next due creates nothing", () => {
    const r = rule({ startOn: "2026-09-15" })
    const first = dueDates(r, "2026-09-15", "2026-11-16")
    expect(dueDates(r, first.nextDue!, "2026-11-16")).toEqual({ dates: [], nextDue: "2026-12-15" })
  })

  it("includes today and stops at the end date", () => {
    const r = rule({ freq: "weekly", startOn: "2026-11-02", endOn: "2026-11-16" })
    expect(dueDates(r, "2026-11-02", "2026-12-31")).toEqual({
      dates: ["2026-11-02", "2026-11-09", "2026-11-16"],
      nextDue: null,
    })
  })

  it("respects the limit and resumes after it", () => {
    const r = rule({ freq: "weekly", startOn: "2026-01-05" })
    const first = dueDates(r, "2026-01-05", "2026-12-31", 2)
    expect(first).toEqual({ dates: ["2026-01-05", "2026-01-12"], nextDue: "2026-01-19" })
  })

  it("snaps a next due that is off the rule to the next real occurrence", () => {
    expect(nextOnOrAfter(rule({ startOn: "2026-01-31" }), "2026-02-01")).toBe("2026-02-28")
  })

  it("describes the rule", () => {
    expect(describeRule({ freq: "monthly", interval: 1 })).toBe("Every month")
    expect(describeRule({ freq: "weekly", interval: 2 })).toBe("Every 2 weeks")
  })
})
