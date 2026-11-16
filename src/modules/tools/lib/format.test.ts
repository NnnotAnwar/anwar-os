import { describe, expect, it } from "vitest"
import { formatNumber, formatPrecise, parseNumberInput } from "./format"

const T = " "

describe("parseNumberInput", () => {
  it("reads dot and comma decimals", () => {
    expect(parseNumberInput("3.5")).toBe(3.5)
    expect(parseNumberInput("3,5")).toBe(3.5)
    expect(parseNumberInput(" 72 ")).toBe(72)
    expect(parseNumberInput(".5")).toBe(0.5)
  })

  it("ignores grouping spaces and accepts the Unicode minus", () => {
    expect(parseNumberInput("10 000")).toBe(10000)
    expect(parseNumberInput(`1${T}000`)).toBe(1000)
    expect(parseNumberInput("−4")).toBe(-4)
  })

  it("returns NaN for empty or malformed input", () => {
    expect(parseNumberInput("")).toBeNaN()
    expect(parseNumberInput("abc")).toBeNaN()
    expect(parseNumberInput("1,2,3")).toBeNaN()
    expect(parseNumberInput("1.2.3")).toBeNaN()
    expect(parseNumberInput("-")).toBeNaN()
  })
})

describe("formatNumber", () => {
  it("groups thousands with a thin space", () => {
    expect(formatNumber(1234567.891)).toBe(`1${T}234${T}567.89`)
    expect(formatNumber(999)).toBe("999")
  })

  it("controls fraction digits", () => {
    expect(formatNumber(2.5, 0)).toBe("3")
    expect(formatNumber(2, 2, 2)).toBe("2.00")
    expect(formatNumber(1 / 3, 4)).toBe("0.3333")
  })

  it("uses a real minus and never shows −0", () => {
    expect(formatNumber(-1500)).toBe(`−1${T}500`)
    expect(formatNumber(-0.001)).toBe("0")
    expect(formatNumber(-0)).toBe("0")
  })

  it("shows a dash for non-finite values", () => {
    expect(formatNumber(Number.NaN)).toBe("—")
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—")
  })
})

describe("formatPrecise", () => {
  it("keeps significant digits without trailing zeros", () => {
    expect(formatPrecise(0.1 + 0.2)).toBe("0.3")
    expect(formatPrecise(1 / 3)).toBe("0.3333333333")
    expect(formatPrecise(1234.5)).toBe(`1${T}234.5`)
    expect(formatPrecise(-42)).toBe("−42")
    expect(formatPrecise(0)).toBe("0")
  })

  it("switches to exponent notation for very large and tiny values", () => {
    expect(formatPrecise(1e20)).toBe("1e+20")
    expect(formatPrecise(1.5e-7)).toBe("1.5e−7")
    expect(formatPrecise(-2.5e18)).toBe("−2.5e+18")
  })
})
