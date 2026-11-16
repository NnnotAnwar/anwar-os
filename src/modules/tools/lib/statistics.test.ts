import { describe, expect, it } from "vitest"
import { histogram, median, modes, parseNumbers, percentile, summarize } from "./statistics"

describe("parseNumbers", () => {
  it("splits on newlines, spaces, tabs, semicolons and commas", () => {
    expect(parseNumbers("1\n2\n3").values).toEqual([1, 2, 3])
    expect(parseNumbers("1 2\t3").values).toEqual([1, 2, 3])
    expect(parseNumbers("1;2; 3").values).toEqual([1, 2, 3])
    expect(parseNumbers("1,2,3").values).toEqual([1, 2, 3])
    expect(parseNumbers("1, 2, 3").values).toEqual([1, 2, 3])
    expect(parseNumbers("1,\n2,\n3,").values).toEqual([1, 2, 3])
  })

  it("ignores blank lines and surrounding whitespace", () => {
    expect(parseNumbers("\n\n  4  \n\n 5 \n").values).toEqual([4, 5])
    expect(parseNumbers("").values).toEqual([])
    expect(parseNumbers("   ").values).toEqual([])
  })

  it("reads decimals, negatives, signs and exponents", () => {
    expect(parseNumbers("1.5 -2 +3 .5 4. 1e3 2.5E-1").values).toEqual([1.5, -2, 3, 0.5, 4, 1000, 0.25])
    expect(parseNumbers("−7").values).toEqual([-7])
  })

  describe("decimal comma", () => {
    it("is used when values are separated otherwise and look like 3,5", () => {
      expect(parseNumbers("3,5 4,25")).toEqual({ values: [3.5, 4.25], invalid: [], decimalComma: true })
      expect(parseNumbers("3,5\n4,2\n7").values).toEqual([3.5, 4.2, 7])
      expect(parseNumbers("3,5; 4,2").values).toEqual([3.5, 4.2])
      expect(parseNumbers("-1,5 2").values).toEqual([-1.5, 2])
    })

    it("is not used when any value has a dot", () => {
      const parsed = parseNumbers("3,5 4.2")
      expect(parsed.decimalComma).toBe(false)
      expect(parsed.values).toEqual([3, 5, 4.2])
    })

    it("is not used for a single comma-separated chunk", () => {
      expect(parseNumbers("1,5")).toEqual({ values: [1, 5], invalid: [], decimalComma: false })
    })

    it("is not used when a chunk has several commas or a trailing one", () => {
      expect(parseNumbers("1,2,3 4").values).toEqual([1, 2, 3, 4])
      expect(parseNumbers("1, 2").decimalComma).toBe(false)
    })

    it("is not claimed for input without commas", () => {
      expect(parseNumbers("1 2").decimalComma).toBe(false)
    })
  })

  it("collects invalid tokens and keeps the rest", () => {
    expect(parseNumbers("1 abc 2 12px n/a 3")).toEqual({
      values: [1, 2, 3],
      invalid: ["abc", "12px", "n/a"],
      decimalComma: false,
    })
    expect(parseNumbers("1.2.3 - .").invalid).toEqual(["1.2.3", "-", "."])
    expect(parseNumbers("Infinity NaN 0x10").invalid).toEqual(["Infinity", "NaN", "0x10"])
  })
})

describe("median", () => {
  it("takes the middle value or the mean of the two middle values", () => {
    expect(median([1, 3, 7])).toBe(3)
    expect(median([1, 3, 7, 9])).toBe(5)
    expect(median([4])).toBe(4)
  })

  it("throws on an empty list", () => {
    expect(() => median([])).toThrow(RangeError)
  })
})

describe("modes", () => {
  it("returns every most frequent value, ascending", () => {
    expect(modes([1, 2, 2, 3])).toEqual([2])
    expect(modes([3, 3, 1, 1, 2])).toEqual([1, 3])
  })

  it("is empty when nothing repeats", () => {
    expect(modes([1, 2, 3])).toEqual([])
    expect(modes([5])).toEqual([])
  })
})

describe("percentile (type 7, linear interpolation)", () => {
  const sorted = [1, 2, 3, 4]

  it("matches Excel PERCENTILE.INC / NumPy defaults", () => {
    expect(percentile(sorted, 25)).toBe(1.75)
    expect(percentile(sorted, 50)).toBe(2.5)
    expect(percentile(sorted, 75)).toBe(3.25)
    expect(percentile([15, 20, 35, 40, 50], 40)).toBe(29)
    expect(percentile([15, 20, 35, 40, 50], 90)).toBe(46)
  })

  it("returns min and max at the ends", () => {
    expect(percentile(sorted, 0)).toBe(1)
    expect(percentile(sorted, 100)).toBe(4)
    expect(percentile([9], 37)).toBe(9)
  })

  it("rejects bad input", () => {
    expect(() => percentile([], 50)).toThrow(RangeError)
    expect(() => percentile(sorted, -1)).toThrow(RangeError)
    expect(() => percentile(sorted, 101)).toThrow(RangeError)
    expect(() => percentile(sorted, Number.NaN)).toThrow(RangeError)
  })
})

describe("histogram", () => {
  it("makes equal-width bins and includes max in the last one", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(histogram(values, 4)).toEqual([
      { from: 1, to: 3.25, count: 3 },
      { from: 3.25, to: 5.5, count: 2 },
      { from: 5.5, to: 7.75, count: 2 },
      { from: 7.75, to: 10, count: 3 },
    ])
  })

  it("defaults to Sturges' rule", () => {
    expect(histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toHaveLength(5)
    expect(histogram([1, 2])).toHaveLength(2)
    expect(histogram(Array.from({ length: 10_000 }, (_, i) => i))).toHaveLength(15)
  })

  it("caps the bin count at 20 and floors it at 1", () => {
    expect(histogram([1, 2, 3], 100)).toHaveLength(20)
    expect(histogram([1, 2, 3], 0)).toHaveLength(1)
  })

  it("counts every value exactly once", () => {
    const values = [0.1, 0.2, 0.3, 0.7, 0.9, 1, 1, 1.3]
    const total = histogram(values, 3).reduce((acc, b) => acc + b.count, 0)
    expect(total).toBe(values.length)
  })

  it("puts identical values into a single bin", () => {
    expect(histogram([5, 5, 5])).toEqual([{ from: 5, to: 5, count: 3 }])
  })

  it("is empty for no values", () => {
    expect(histogram([])).toEqual([])
  })
})

describe("summarize", () => {
  it("computes the full summary", () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!
    expect(s.count).toBe(8)
    expect(s.sum).toBe(40)
    expect(s.mean).toBe(5)
    expect(s.median).toBe(4.5)
    expect(s.modes).toEqual([4])
    expect(s.min).toBe(2)
    expect(s.max).toBe(9)
    expect(s.range).toBe(7)
    expect(s.populationVariance).toBe(4)
    expect(s.populationSD).toBe(2)
    expect(s.sampleVariance).toBeCloseTo(32 / 7, 12)
    expect(s.sampleSD).toBeCloseTo(Math.sqrt(32 / 7), 12)
    expect(s.q1).toBe(4)
    expect(s.q3).toBe(5.5)
    expect(s.iqr).toBe(1.5)
    expect(s.sorted).toEqual([2, 4, 4, 4, 5, 5, 7, 9])
  })

  it("doesn't reorder the caller's array", () => {
    const input = [3, 1, 2]
    summarize(input)
    expect(input).toEqual([3, 1, 2])
  })

  it("leaves sample variance undefined for one value", () => {
    const s = summarize([42])!
    expect(s.populationVariance).toBe(0)
    expect(s.sampleVariance).toBeUndefined()
    expect(s.sampleSD).toBeUndefined()
    expect(s.median).toBe(42)
    expect(s.q1).toBe(42)
  })

  it("stays accurate for large values with a small spread", () => {
    const s = summarize([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16])!
    expect(s.populationVariance).toBeCloseTo(22.5, 6)
  })

  it("handles negatives", () => {
    const s = summarize([-5, -1, 0, 3])!
    expect(s.mean).toBe(-0.75)
    expect(s.range).toBe(8)
  })

  it("returns undefined for no values", () => {
    expect(summarize([])).toBeUndefined()
  })
})
