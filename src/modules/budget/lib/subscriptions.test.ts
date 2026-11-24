import { describe, expect, it } from "vitest"
import { chargesBetween, chargesPerYear, dayRange, monthlyCost, nextCharge, relativeDay, totalsByCurrency, yearlyCost } from "./subscriptions"

const monthly = { freq: "monthly" as const, interval: 1, startOn: "2026-01-31", endOn: null, nextDue: "2026-11-30", active: true }

describe("subscription costs", () => {
  it("spreads every cadence over a month and a year", () => {
    expect(chargesPerYear({ freq: "monthly", interval: 1 })).toBe(12)
    expect(chargesPerYear({ freq: "weekly", interval: 2 })).toBe(26)
    expect(chargesPerYear({ freq: "yearly", interval: 1 })).toBe(1)
    expect(monthlyCost(-29900, { freq: "monthly", interval: 1 })).toBe(29900)
    expect(yearlyCost(-29900, { freq: "monthly", interval: 1 })).toBe(358800)
    expect(monthlyCost(-120000, { freq: "yearly", interval: 1 })).toBe(10000)
    expect(monthlyCost(-10000, { freq: "weekly", interval: 1 })).toBe(43333)
    expect(yearlyCost(-60000, { freq: "monthly", interval: 3 })).toBe(240000)
  })

  it("totals per currency, base first, a month being a twelfth of the year", () => {
    const totals = totalsByCurrency(
      [
        { currency: "EUR", amountMinor: -999, freq: "monthly", interval: 1 },
        { currency: "CZK", amountMinor: -29900, freq: "monthly", interval: 1 },
        { currency: "CZK", amountMinor: -94100, freq: "monthly", interval: 1 },
      ],
      "CZK",
    )
    expect(totals).toEqual([
      { currency: "CZK", monthlyMinor: 124000, yearlyMinor: 1488000, count: 2 },
      { currency: "EUR", monthlyMinor: 999, yearlyMinor: 11988, count: 1 },
    ])
  })
})

describe("next charge", () => {
  it("is the template's next due date, or the first one from today when that is overdue", () => {
    expect(nextCharge(monthly, "2026-11-24")).toBe("2026-11-30")
    // Not generated since October: the next charge from today on.
    expect(nextCharge({ ...monthly, nextDue: "2026-10-31" }, "2026-11-24")).toBe("2026-11-30")
    expect(nextCharge({ ...monthly, nextDue: "2026-10-31" }, "2026-12-01")).toBe("2026-12-31")
  })

  it("is null when paused or past the end", () => {
    expect(nextCharge({ ...monthly, active: false }, "2026-11-24")).toBeNull()
    expect(nextCharge({ ...monthly, endOn: "2026-11-29" }, "2026-11-24")).toBeNull()
  })
})

describe("charges in a range", () => {
  it("lists unrecorded charges inside the range, respecting short months and the end date", () => {
    expect(chargesBetween(monthly, "2026-11-24", "2027-03-01")).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"])
    expect(chargesBetween({ ...monthly, endOn: "2027-01-15" }, "2026-11-24", "2027-03-01")).toEqual(["2026-11-30", "2026-12-31"])
  })

  it("skips charges before the next due date (already recorded) and paused templates", () => {
    const weekly = { freq: "weekly" as const, interval: 1, startOn: "2026-11-02", endOn: null, nextDue: "2026-11-23", active: true }
    expect(chargesBetween(weekly, "2026-11-16", "2026-11-30")).toEqual(["2026-11-23", "2026-11-30"])
    expect(chargesBetween({ ...weekly, active: false }, "2026-11-16", "2026-11-30")).toEqual([])
    expect(chargesBetween(weekly, "2026-11-24", "2026-11-29")).toEqual([])
  })

  it("covers the next 7 days with dayRange", () => {
    expect(dayRange("2026-11-24", 7)).toEqual({ from: "2026-11-24", to: "2026-11-30" })
    expect(dayRange("2026-11-24", 1)).toEqual({ from: "2026-11-24", to: "2026-11-24" })
  })
})

describe("relativeDay", () => {
  it("names the next few days", () => {
    expect(relativeDay("2026-11-24", "2026-11-24")).toBe("Today")
    expect(relativeDay("2026-11-25", "2026-11-24")).toBe("Tomorrow")
    expect(relativeDay("2026-11-27", "2026-11-24")).toBe("In 3 days")
    expect(relativeDay("2026-12-24", "2026-11-24")).toBeNull()
  })
})
