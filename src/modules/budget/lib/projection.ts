// The capital-growth plan against reality, month by month.
//
// Point m (m = 0 … horizon·12) is the end of the m-th plan month; point 0 is
// the starting capital at the start of the first month. The projection reuses
// the compound-growth formula from the tools module (monthly compounding,
// contributions at month end), so both pages agree to the haléř.

import { futureValue } from "@/modules/tools/lib/compound"
import { monthOf, monthsBetween, shiftMonth } from "./dates"

export type Plan = {
  startingCapitalMinor: number
  monthlyContributionMinor: number
  /** Basis points: 700 = 7.00 % a year. */
  annualReturnBp: number
  horizonYears: number
  /** First day of the first plan month, "2026-11-01". */
  startOn: string
}

export type ProjectionPoint = {
  /** The month this point closes ("2026-11"); point 0 closes the month before the plan. */
  month: string
  index: number
  projectedMinor: number
  /** Starting capital plus contributions so far. */
  contributedMinor: number
}

export function projectPlan(plan: Plan): ProjectionPoint[] {
  const start = monthOf(plan.startOn)
  const months = plan.horizonYears * 12
  const points: ProjectionPoint[] = []
  for (let m = 0; m <= months; m++) {
    const projected = futureValue({
      initial: plan.startingCapitalMinor,
      monthly: plan.monthlyContributionMinor,
      annualRate: plan.annualReturnBp / 100,
      years: m / 12,
    })
    points.push({
      month: shiftMonth(start, m - 1),
      index: m,
      projectedMinor: Math.round(projected),
      contributedMinor: plan.startingCapitalMinor + plan.monthlyContributionMinor * m,
    })
  }
  return points
}

export type AccountOpening = { openingBalanceMinor: number; openedOn: string }

/**
 * Net worth at the end of each month in `months` (ascending "YYYY-MM"):
 * opening balances of accounts opened by then plus every transaction up to
 * the month's end. `monthlySums` maps "YYYY-MM" → the net of that month's
 * transactions; months before the first requested one are folded in.
 */
export function netWorthByMonth(
  accounts: AccountOpening[],
  monthlySums: Map<string, number>,
  months: string[],
): Map<string, number> {
  const result = new Map<string, number>()
  if (months.length === 0) return result
  const sorted = [...monthlySums.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  let i = 0
  let running = 0
  for (const month of months) {
    while (i < sorted.length && sorted[i]![0] <= month) running += sorted[i++]![1]
    const opening = accounts
      .filter((a) => monthOf(a.openedOn) <= month)
      .reduce((sum, a) => sum + a.openingBalanceMinor, 0)
    result.set(month, opening + running)
  }
  return result
}

export type ComparisonRow = ProjectionPoint & { actualMinor: number | null; deltaMinor: number | null }

/** Projection rows with the actual net worth for months that have closed (or the current one). */
export function comparePlan(points: ProjectionPoint[], actual: Map<string, number>, currentMonth: string): ComparisonRow[] {
  return points.map((p) => {
    const known = p.month <= currentMonth ? (actual.get(p.month) ?? null) : null
    return { ...p, actualMinor: known, deltaMinor: known === null ? null : known - p.projectedMinor }
  })
}

/** The plan months to fetch actuals for: point 0's month through the current month. */
export function actualMonths(plan: Plan, currentMonth: string): string[] {
  const first = shiftMonth(monthOf(plan.startOn), -1)
  const last = currentMonth
  const count = Math.min(monthsBetween(first, last), plan.horizonYears * 12)
  if (count < 0) return []
  return Array.from({ length: count + 1 }, (_, k) => shiftMonth(first, k))
}
