import { describe, expect, it } from "vitest"
import { amountQuery } from "./amount-search"

describe("amountQuery", () => {
  it("covers the cents of a whole number, either sign", () => {
    expect(amountQuery("250")).toEqual({ min: 25000, max: 25099, sign: null })
  })

  it("matches typed decimals exactly", () => {
    expect(amountQuery("250,50")).toEqual({ min: 25050, max: 25050, sign: null })
    expect(amountQuery("250.5")).toEqual({ min: 25050, max: 25050, sign: null })
    expect(amountQuery("250.00")).toEqual({ min: 25000, max: 25000, sign: null })
  })

  it("keeps an explicit sign", () => {
    expect(amountQuery("-250")).toEqual({ min: 25000, max: 25099, sign: "-" })
    expect(amountQuery("+5000")).toEqual({ min: 500000, max: 500099, sign: "+" })
  })

  it("reads grouped thousands and a currency", () => {
    expect(amountQuery("1 250 Kč")).toEqual({ min: 125000, max: 125099, sign: null })
    expect(amountQuery("1,234")).toEqual({ min: 123400, max: 123499, sign: null })
  })

  it("is null for words and zero", () => {
    expect(amountQuery("coffee")).toBeNull()
    expect(amountQuery("coffee 250")).toBeNull()
    expect(amountQuery("0")).toBeNull()
    expect(amountQuery("")).toBeNull()
  })
})
