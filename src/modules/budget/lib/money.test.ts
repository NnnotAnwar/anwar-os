import { describe, expect, it } from "vitest"
import { amountToInput, formatMoney, parseAmount, parseSignedAmount, savingsRate } from "./money"

const minor = (s: string) => parseAmount(s)?.minor ?? null

describe("parseAmount", () => {
  it("reads Czech formats", () => {
    expect(minor("1 234,50")).toBe(123450)
    expect(minor("1 234,50")).toBe(123450)
    expect(minor("1 234,5")).toBe(123450)
    expect(minor("1.234,50")).toBe(123450)
    expect(minor("250 Kč")).toBe(25000)
    expect(minor("12 345 678,90 CZK")).toBe(1234567890)
  })

  it("reads English formats", () => {
    expect(minor("1,234.50")).toBe(123450)
    expect(minor("1234.5")).toBe(123450)
    expect(minor("€ 99.99")).toBe(9999)
    expect(minor("1,234,567")).toBe(123456700)
  })

  it("treats one separator before exactly three digits as thousands", () => {
    expect(minor("1,234")).toBe(123400)
    expect(minor("1.234")).toBe(123400)
    expect(minor("12,345")).toBe(1234500)
    expect(minor("12,5")).toBe(1250)
    expect(minor("12.50")).toBe(1250)
    expect(minor(",5")).toBe(50)
  })

  it("keeps the sign when it is written", () => {
    expect(parseAmount("-250")).toEqual({ minor: 25000, sign: "-" })
    expect(parseAmount("−1 234,50 Kč")).toEqual({ minor: 123450, sign: "-" })
    expect(parseAmount("+5000")).toEqual({ minor: 500000, sign: "+" })
    expect(parseAmount("(100,00)")).toEqual({ minor: 10000, sign: "-" })
    expect(parseAmount("250-")).toEqual({ minor: 25000, sign: "-" })
    expect(parseAmount("250")).toEqual({ minor: 25000, sign: null })
  })

  it("rejects text that is not one clear amount", () => {
    for (const bad of ["", "abc", "Lidl 123", "1,2,3", "1.23.4", "1.234.56", "--5", "0,500", "1e5", "12..5"]) {
      expect(parseAmount(bad), bad).toBeNull()
    }
    expect(parseAmount("1 000 000 000 000")).toBeNull()
  })
})

describe("parseSignedAmount", () => {
  it("uses the default sign for bare numbers", () => {
    expect(parseSignedAmount("250", -1)).toBe(-25000)
    expect(parseSignedAmount("+250", -1)).toBe(25000)
    expect(parseSignedAmount("-250", 1)).toBe(-25000)
    expect(parseSignedAmount("0", 1)).toBeNull()
  })
})

describe("formatting", () => {
  // Intl spaces vary (nbsp, narrow nbsp); compare with plain spaces.
  const plain = (s: string) => s.replace(/\s/g, " ")

  it("formats per locale and drops decimals on whole amounts", () => {
    expect(plain(formatMoney(123450, "CZK", "en"))).toBe("CZK 1,234.50")
    expect(plain(formatMoney(500000, "CZK", "cs"))).toBe("5 000 Kč")
    expect(formatMoney(500000, "EUR", "en", { fixed: true })).toBe("€5,000.00")
    expect(formatMoney(-2500, "EUR", "en", { signed: true })).toBe("-€25")
    expect(formatMoney(2500, "EUR", "en", { signed: true })).toBe("+€25")
  })

  it("round-trips through the input format", () => {
    for (const value of [123450, -2505, 100, 7, 0]) {
      const text = amountToInput(value)
      const parsed = parseAmount(text)!
      expect((parsed.sign === "-" ? -1 : 1) * parsed.minor).toBe(value)
    }
  })

  it("computes the savings rate", () => {
    expect(savingsRate(100000, 75000)).toBe(25)
    expect(savingsRate(100000, 130000)).toBe(-30)
    expect(savingsRate(0, 5000)).toBeNull()
  })
})
