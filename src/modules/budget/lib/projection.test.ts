import { describe, expect, it } from "vitest"
import { compoundGrowth } from "@/modules/tools/lib/compound"
import { actualMonths, comparePlan, netWorthByMonth, projectPlan, type Plan } from "./projection"

const plan: Plan = {
  startingCapitalMinor: 10_000_000,
  monthlyContributionMinor: 1_000_000,
  annualReturnBp: 700,
  horizonYears: 2,
  startOn: "2026-01-01",
}

describe("projectPlan", () => {
  it("starts at the starting capital and agrees with the compound calculator each year", () => {
    const points = projectPlan(plan)
    expect(points).toHaveLength(25)
    expect(points[0]).toMatchObject({ month: "2025-12", projectedMinor: 10_000_000, contributedMinor: 10_000_000 })
    expect(points[12]!.month).toBe("2026-12")
    const tools = compoundGrowth({ initial: 10_000_000, monthly: 1_000_000, annualRate: 7, years: 2 })
    if (!tools.ok) throw new Error("bad input")
    expect(points[12]!.projectedMinor).toBe(Math.round(tools.result.rows[0]!.balance))
    expect(points[24]!.projectedMinor).toBe(Math.round(tools.result.finalBalance))
    expect(points[24]!.contributedMinor).toBe(10_000_000 + 24 * 1_000_000)
  })

  it("is linear with a zero return", () => {
    const points = projectPlan({ ...plan, annualReturnBp: 0 })
    expect(points[5]!.projectedMinor).toBe(10_000_000 + 5 * 1_000_000)
  })
})

describe("actual net worth", () => {
  it("adds opening balances from their month and transactions cumulatively", () => {
    const sums = new Map([
      ["2025-10", 50_000],
      ["2026-01", -20_000],
      ["2026-02", 30_000],
    ])
    const accounts = [
      { openingBalanceMinor: 1_000_000, openedOn: "2025-06-10" },
      { openingBalanceMinor: 500_000, openedOn: "2026-02-03" },
    ]
    const worth = netWorthByMonth(accounts, sums, ["2025-12", "2026-01", "2026-02"])
    expect([...worth.entries()]).toEqual([
      ["2025-12", 1_050_000],
      ["2026-01", 1_030_000],
      ["2026-02", 1_560_000],
    ])
  })

  it("compares only months that have happened", () => {
    expect(actualMonths(plan, "2026-02")).toEqual(["2025-12", "2026-01", "2026-02"])
    expect(actualMonths(plan, "2025-06")).toEqual([])
    const rows = comparePlan(projectPlan(plan).slice(0, 4), new Map([["2026-01", 11_500_000]]), "2026-02")
    expect(rows.map((r) => r.actualMinor)).toEqual([null, 11_500_000, null, null])
    expect(rows[1]!.deltaMinor).toBe(11_500_000 - rows[1]!.projectedMinor)
  })
})
