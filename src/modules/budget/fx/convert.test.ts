import { describe, expect, it } from "vitest"
import { convertMinor, convertOn, CZK_QUOTE, FxTally, pickRate, ratesLabel, scaleRate, unitRate, type RateBook } from "./convert"

const eur = { units: 1, rate: "24.470" }
const jpy = { units: 100, rate: "14.031" }
const usd = { units: 1, rate: "22.262" }

function book(partial: Partial<RateBook> = {}): RateBook {
  return {
    days: new Map([
      ["2026-11-20", "2026-11-20"],
      ["2026-11-21", "2026-11-20"],
      ["2026-11-22", "2026-11-20"],
      ["2026-11-23", "2026-11-23"],
    ]),
    rows: [
      { source: "daily", validOn: "2026-11-20", currency: "EUR", units: 1, rate: "24.47" },
      { source: "daily", validOn: "2026-11-23", currency: "EUR", units: 1, rate: "24.5" },
      { source: "daily", validOn: "2026-11-20", currency: "USD", units: 1, rate: "22.262" },
      { source: "daily", validOn: "2026-11-23", currency: "USD", units: 1, rate: "22.3" },
      { source: "monthly", validOn: "2026-11-01", currency: "KZT", units: 100, rate: "4.809" },
    ],
    ...partial,
  }
}

describe("conversion math", () => {
  it("scales rates exactly", () => {
    expect(scaleRate("24.470")).toBe(BigInt(24_470_000))
    expect(scaleRate("1")).toBe(BigInt(1_000_000))
    expect(scaleRate("0.000123")).toBe(BigInt(123))
    expect(() => scaleRate("1,5")).toThrow()
  })

  it("converts minor units into CZK, rounding half away from zero", () => {
    // 12.99 EUR × 24.470 = 317.8653 CZK → 317.87
    expect(convertMinor(1299, eur, CZK_QUOTE)).toBe(31787)
    expect(convertMinor(-1299, eur, CZK_QUOTE)).toBe(-31787)
    // 1 000 JPY at 14.031 per 100 = 140.31 CZK
    expect(convertMinor(100000, jpy, CZK_QUOTE)).toBe(14031)
    // Exactly half a minor unit: 0.50 at 0.01 → 0.005 → 0.01 (away from zero), both signs.
    expect(convertMinor(50, { units: 1, rate: "0.01" }, CZK_QUOTE)).toBe(1)
    expect(convertMinor(-50, { units: 1, rate: "0.01" }, CZK_QUOTE)).toBe(-1)
    expect(convertMinor(49, { units: 1, rate: "0.01" }, CZK_QUOTE)).toBe(0)
  })

  it("crosses through CZK when the base isn't CZK, rounding once", () => {
    // 100.00 USD → EUR: 100 × 22.262 / 24.470 = 90.9767… → 90.98
    expect(convertMinor(10000, usd, eur)).toBe(9098)
    // CZK → EUR: 1 000 / 24.47 = 40.866… → 40.87
    expect(convertMinor(100000, CZK_QUOTE, eur)).toBe(4087)
    expect(unitRate(usd, eur)).toBe(0.909767)
    expect(unitRate(jpy, CZK_QUOTE)).toBe(0.14031)
  })

  it("stays exact for large amounts", () => {
    expect(convertMinor(99_999_999_999_999, eur, CZK_QUOTE)).toBe(2_446_999_999_999_976)
  })
})

describe("which rate a day uses", () => {
  it("takes the day's own fixing, or the latest before it on weekends", () => {
    expect(pickRate(book(), "EUR", "2026-11-23")).toMatchObject({ rate: "24.5", rateOn: "2026-11-23", source: "daily", approximate: false })
    // Sunday: ČNB answered with Friday's fixing.
    expect(pickRate(book(), "EUR", "2026-11-22")).toMatchObject({ rate: "24.47", rateOn: "2026-11-20", approximate: false })
  })

  it("uses the monthly list for currencies outside the daily fixing", () => {
    expect(pickRate(book(), "KZT", "2026-11-22")).toMatchObject({ units: 100, rate: "4.809", source: "monthly", rateOn: "2026-11-01", approximate: false })
  })

  it("falls back to the latest earlier rate, marked approximate, when the day wasn't fetched", () => {
    // 24 Nov: ČNB unreachable, nothing recorded for the day → Monday's fixing stands in.
    expect(pickRate(book(), "EUR", "2026-11-24")).toMatchObject({ rate: "24.5", rateOn: "2026-11-23", approximate: true })
    // KZT in December without December's list: November's list stands in.
    expect(pickRate(book(), "KZT", "2026-12-03")).toMatchObject({ rateOn: "2026-11-01", approximate: true })
  })

  it("gives up on unknown currencies and on rates that are too old", () => {
    expect(pickRate(book(), "XTS", "2026-11-23")).toBeNull()
    expect(pickRate(book(), "EUR", "2027-03-01")).toBeNull()
    expect(pickRate(book(), "EUR", "2026-11-19")).toBeNull()
  })

  it("treats CZK as 1", () => {
    expect(pickRate(book({ rows: [], days: new Map() }), "CZK", "2026-11-23")).toMatchObject({ rate: "1", units: 1, source: "identity" })
  })
})

describe("converting amounts on their day", () => {
  it("converts into CZK and into another base", () => {
    expect(convertOn(book(), -1299, "EUR", "2026-11-22", "CZK")).toEqual({ minor: -31787, rateOn: "2026-11-20", approximate: false })
    // EUR base: a CZK amount and a USD amount on Monday.
    expect(convertOn(book(), 24500, "CZK", "2026-11-23", "EUR")).toEqual({ minor: 1000, rateOn: "2026-11-23", approximate: false })
    expect(convertOn(book(), 2450, "USD", "2026-11-23", "EUR")).toEqual({ minor: 2230, rateOn: "2026-11-23", approximate: false })
    expect(convertOn(book(), 500, "EUR", "2026-11-23", "EUR")).toEqual({ minor: 500, rateOn: "2026-11-23", approximate: false })
    expect(convertOn(book(), 500, "XTS", "2026-11-23", "CZK")).toBeNull()
  })

  it("tallies what was used, so a total equals the sum of its rounded lines", () => {
    const fx = new FxTally(book(), "CZK")
    const lines = [fx.convert(-1299, "EUR", "2026-11-20"), fx.convert(-1, "EUR", "2026-11-23"), fx.convert(-1, "EUR", "2026-11-23")]
    expect(lines).toEqual([-31787, -25, -25])
    expect(fx.convert(-100, "XTS", "2026-11-23")).toBeNull()
    expect(fx.convert(-100, "CZK", "2026-11-23")).toBe(-100)
    expect(fx.note()).toEqual({ source: "ČNB", rateOn: "2026-11-23", approximate: false, converted: ["EUR"], unavailable: ["XTS"] })
    fx.convert(100, "EUR", "2026-11-24")
    expect(fx.note().approximate).toBe(true)
  })

  it("labels the rates", () => {
    const note = { source: "ČNB" as const, rateOn: "2026-11-25", approximate: false, converted: ["EUR"], unavailable: [] }
    expect(ratesLabel(note, "2026-11-25")).toBe("Rates: ČNB, 25 Nov")
    expect(ratesLabel(note, "2027-01-02")).toBe("Rates: ČNB, 25 Nov 2026")
    expect(ratesLabel({ ...note, approximate: true }, "2026-11-25")).toMatch(/some older/)
    expect(ratesLabel({ ...note, rateOn: null })).toBeNull()
  })
})
