/**
 * Compound growth with monthly compounding and monthly contributions.
 *
 * The annual rate is nominal: each month earns rate / 12. Contributions land at
 * the end of each month (an ordinary annuity), so a deposit starts earning the
 * following month. The initial capital is invested at month 0.
 */

export const COMPOUND_LIMITS = {
  initial: { min: 0, max: 1e12 },
  monthly: { min: 0, max: 1e10 },
  annualRate: { min: -50, max: 100 },
  years: { min: 1, max: 100 },
} as const

export type CompoundInput = {
  initial: number
  monthly: number
  /** Nominal annual rate in percent, e.g. 7 for 7%. */
  annualRate: number
  /** Whole years. */
  years: number
}

export type YearRow = {
  year: number
  /** Initial capital plus every contribution so far. */
  contributed: number
  /** Cumulative interest earned so far. */
  interest: number
  balance: number
  interestThisYear: number
}

export type CompoundResult = {
  rows: YearRow[]
  finalBalance: number
  totalContributed: number
  totalInterest: number
}

export type CompoundErrors = Partial<Record<keyof CompoundInput, string>>

export function validateCompound(input: CompoundInput): CompoundErrors {
  const errors: CompoundErrors = {}
  for (const key of Object.keys(COMPOUND_LIMITS) as (keyof CompoundInput)[]) {
    const value = input[key]
    const { min, max } = COMPOUND_LIMITS[key]
    if (!Number.isFinite(value)) errors[key] = "Enter a number"
    else if (value < min || value > max) errors[key] = `Use ${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`
    else if (key === "years" && !Number.isInteger(value)) errors[key] = "Use whole years"
  }
  return errors
}

export function compoundGrowth(
  input: CompoundInput,
): { ok: true; result: CompoundResult } | { ok: false; errors: CompoundErrors } {
  const errors = validateCompound(input)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const r = input.annualRate / 100 / 12
  let balance = input.initial
  let contributed = input.initial
  let interest = 0
  const rows: YearRow[] = []

  for (let year = 1; year <= input.years; year++) {
    let interestThisYear = 0
    for (let month = 0; month < 12; month++) {
      const earned = balance * r
      interestThisYear += earned
      balance += earned + input.monthly
      contributed += input.monthly
    }
    interest += interestThisYear
    rows.push({ year, contributed, interest, balance, interestThisYear })
  }

  return {
    ok: true,
    result: { rows, finalBalance: balance, totalContributed: contributed, totalInterest: interest },
  }
}

/**
 * Closed-form future value, FV = P(1 + r)ⁿ + PMT · ((1 + r)ⁿ − 1) / r, with n in
 * months. Used to cross-check the month-by-month simulation.
 */
export function futureValue({ initial, monthly, annualRate, years }: CompoundInput): number {
  const r = annualRate / 100 / 12
  const n = years * 12
  if (r === 0) return initial + monthly * n
  const growth = (1 + r) ** n
  return initial * growth + (monthly * (growth - 1)) / r
}
