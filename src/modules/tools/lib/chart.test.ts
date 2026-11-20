import { describe, expect, it } from "vitest"
import { compactNumber, niceStep, niceTicks } from "./chart"
import { boxPlot } from "./statistics"

describe("niceStep / niceTicks", () => {
  it("picks 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceStep(100, 4)).toBe(25)
    expect(niceStep(1000, 4)).toBe(250)
    expect(niceStep(7, 4)).toBe(2)
    expect(niceStep(0)).toBe(1)
  })

  it("covers the maximum from zero", () => {
    expect(niceTicks(180_000, 4)).toEqual([0, 50_000, 100_000, 150_000, 200_000])
    expect(niceTicks(3, 4)).toEqual([0, 1, 2, 3])
    expect(niceTicks(10, 4, -4)).toEqual([-5, 0, 5, 10])
  })
})

describe("compactNumber", () => {
  it("abbreviates thousands, millions and billions", () => {
    expect(compactNumber(950)).toBe("950")
    expect(compactNumber(12_400)).toBe("12k")
    expect(compactNumber(1_250_000)).toBe("1.3M")
    expect(compactNumber(-2500)).toBe("−2.5k")
    expect(compactNumber(2.345)).toBe("2.35")
  })
})

describe("boxPlot", () => {
  it("draws whiskers to the last values inside 1.5 × IQR and keeps the rest as outliers", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 40]
    const box = boxPlot(sorted)
    expect(box.q1).toBe(3.25)
    expect(box.median).toBe(5.5)
    expect(box.q3).toBe(7.75)
    expect(box.lowerWhisker).toBe(1)
    expect(box.upperWhisker).toBe(9)
    expect(box.outliers).toEqual([40])
  })

  it("handles a single value", () => {
    expect(boxPlot([5])).toEqual({ q1: 5, median: 5, q3: 5, lowerWhisker: 5, upperWhisker: 5, outliers: [] })
  })
})
