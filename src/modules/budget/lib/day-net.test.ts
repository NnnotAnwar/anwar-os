import { describe, expect, it } from "vitest"
import { dayNet } from "./day-net"

const czk = (amountMinor: number, transferId: string | null = null) => ({ amountMinor, currency: "CZK", transferId, baseAmount: null })
const eur = (amountMinor: number, base: number | null) => ({
  amountMinor,
  currency: "EUR",
  transferId: null,
  baseAmount: base === null ? null : { minor: base, currency: "CZK", rateOn: "2026-11-25", approximate: false },
})

describe("dayNet", () => {
  it("adds up a day in one currency exactly, without transfers", () => {
    expect(dayNet([czk(-30_000), czk(-600), czk(-10_000, "t1")])).toEqual({ kind: "exact", minor: -30_600, currency: "CZK" })
    expect(dayNet([czk(-10_000, "t1")])).toBeNull()
    expect(dayNet([])).toBeNull()
  })

  it("never adds EUR to CZK as they are: converted rows give one approximate base total", () => {
    // -300 CZK and -12 EUR (≈ -293.22 CZK) is ≈ -593.22 CZK, not -312.
    expect(dayNet([czk(-30_000), eur(-1_200, -29_322)])).toEqual({ kind: "converted", minor: -59_322, currency: "CZK" })
  })

  it("falls back to one net per currency when a row has no rate", () => {
    expect(dayNet([czk(-30_000), eur(-1_200, null), eur(-800, null)])).toEqual({
      kind: "per-currency",
      nets: [
        { currency: "CZK", minor: -30_000 },
        { currency: "EUR", minor: -2_000 },
      ],
    })
  })
})
