import { describe, expect, it } from "vitest"
import { compoundGrowth, futureValue, validateCompound, type CompoundInput } from "./compound"

function run(input: CompoundInput) {
  const res = compoundGrowth(input)
  if (!res.ok) throw new Error(JSON.stringify(res.errors))
  return res.result
}

describe("compoundGrowth", () => {
  it("compounds the initial capital monthly", () => {
    const { finalBalance, totalInterest, totalContributed } = run({ initial: 1000, monthly: 0, annualRate: 12, years: 1 })
    // 1000 · 1.01¹²
    expect(finalBalance).toBeCloseTo(1126.825030131969, 9)
    expect(totalInterest).toBeCloseTo(126.825030131969, 9)
    expect(totalContributed).toBe(1000)
  })

  it("adds contributions at the end of each month", () => {
    const { finalBalance } = run({ initial: 0, monthly: 100, annualRate: 12, years: 1 })
    // 100 · (1.01¹² − 1) / 0.01
    expect(finalBalance).toBeCloseTo(1268.250301319698, 9)
  })

  it("matches the closed-form future value", () => {
    const input = { initial: 10_000, monthly: 500, annualRate: 7, years: 30 }
    const { finalBalance } = run(input)
    expect(finalBalance).toBeCloseTo(futureValue(input), 6)
    expect(finalBalance).toBeCloseTo(691_150.47, 1)
  })

  it("builds one row per year with consistent running totals", () => {
    const { rows } = run({ initial: 5000, monthly: 200, annualRate: 5, years: 10 })
    expect(rows).toHaveLength(10)
    expect(rows.map((r) => r.year)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(rows[0].contributed).toBe(5000 + 12 * 200)
    expect(rows[9].contributed).toBe(5000 + 120 * 200)
    let interest = 0
    for (const row of rows) {
      interest += row.interestThisYear
      expect(row.interest).toBeCloseTo(interest, 9)
      expect(row.balance).toBeCloseTo(row.contributed + row.interest, 9)
    }
    // Interest grows every year with a positive rate.
    for (let i = 1; i < rows.length; i++) expect(rows[i].interestThisYear).toBeGreaterThan(rows[i - 1].interestThisYear)
  })

  it("grows linearly at a 0% rate", () => {
    const { finalBalance, totalInterest } = run({ initial: 1000, monthly: 100, annualRate: 0, years: 2 })
    expect(finalBalance).toBe(3400)
    expect(totalInterest).toBe(0)
    expect(futureValue({ initial: 1000, monthly: 100, annualRate: 0, years: 2 })).toBe(3400)
  })

  it("shrinks with a negative rate", () => {
    const { finalBalance, totalInterest } = run({ initial: 1000, monthly: 0, annualRate: -12, years: 1 })
    expect(finalBalance).toBeCloseTo(1000 * 0.99 ** 12, 9)
    expect(totalInterest).toBeLessThan(0)
  })

  it("rejects invalid input", () => {
    const res = compoundGrowth({ initial: -1, monthly: Number.NaN, annualRate: 150, years: 2.5 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors).toEqual({
      initial: "Use 0–1,000,000,000,000",
      monthly: "Enter a number",
      annualRate: "Use -50–100",
      years: "Use whole years",
    })
  })

  it("accepts the boundaries", () => {
    expect(validateCompound({ initial: 0, monthly: 0, annualRate: -50, years: 100 })).toEqual({})
    expect(validateCompound({ initial: 0, monthly: 0, annualRate: 0, years: 0 }).years).toBe("Use 1–100")
  })
})
