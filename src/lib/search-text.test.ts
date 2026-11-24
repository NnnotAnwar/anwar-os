import { describe, expect, it } from "vitest"
import { excerptAround, highlightParts, matches, queryTerms, shortDate } from "./search-text"

describe("queryTerms", () => {
  it("puts the phrase first, then words of two or more characters", () => {
    expect(queryTerms("  Coffee   beans a ")).toEqual(["coffee beans a", "coffee", "beans"])
  })

  it("is empty for a blank query", () => {
    expect(queryTerms("   ")).toEqual([])
  })
})

describe("highlightParts", () => {
  it("marks every match case-insensitively and keeps the original spelling", () => {
    expect(highlightParts("Coffee with coffee lovers", "COFFEE")).toEqual([
      { text: "Coffee", match: true },
      { text: " with ", match: false },
      { text: "coffee", match: true },
      { text: " lovers", match: false },
    ])
  })

  it("marks the words of a query when the phrase isn't there", () => {
    const parts = highlightParts("Beans for the coffee", "coffee beans")
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["Beans", "coffee"])
  })

  it("treats regex characters literally", () => {
    expect(highlightParts("C++ (draft)", "(draft")).toEqual([
      { text: "C++ ", match: false },
      { text: "(draft", match: true },
      { text: ")", match: false },
    ])
  })

  it("matches Cyrillic and Czech text", () => {
    expect(highlightParts("Купить Молоко", "молоко").at(-1)).toEqual({ text: "Молоко", match: true })
    expect(highlightParts("Účet za ŠKOLKU", "školku").at(-1)).toEqual({ text: "ŠKOLKU", match: true })
  })

  it("returns the text unmarked without a query, and nothing for empty text", () => {
    expect(highlightParts("Notes", "")).toEqual([{ text: "Notes", match: false }])
    expect(highlightParts("", "x")).toEqual([])
  })

  it("finds amounts inside formatted money", () => {
    expect(highlightParts("−250,00 Kč", "250").some((p) => p.match && p.text === "250")).toBe(true)
  })
})

describe("matches", () => {
  it("accepts the phrase or all of its words", () => {
    expect(matches("Dentist on Monday", "dentist")).toBe(true)
    expect(matches("Monday: dentist", "dentist monday")).toBe(true)
    expect(matches("Dentist", "dentist friday")).toBe(false)
    expect(matches(null, "x")).toBe(false)
  })
})

describe("shortDate", () => {
  const now = new Date("2026-11-24T10:00:00Z")
  const opts = { locale: "en-GB", timeZone: "Europe/Prague", now }

  it("leaves out this year", () => {
    expect(shortDate("2026-03-05", opts)).toBe("5 Mar")
  })

  it("names another year", () => {
    expect(shortDate("2025-12-31", opts)).toBe("31 Dec 2025")
  })

  it("reads an instant in the viewer's time zone", () => {
    // 23:30 UTC on 1 Nov is already 2 Nov in Prague.
    expect(shortDate(new Date("2026-11-01T23:30:00Z"), opts)).toBe("2 Nov")
    expect(shortDate("2026-11-01T23:30:00.000Z", opts)).toBe("2 Nov")
  })

  it("is empty for an invalid date", () => {
    expect(shortDate("not a date", opts)).toBe("")
  })
})

describe("excerptAround", () => {
  const long = `${"Lorem ipsum dolor sit amet ".repeat(6)}the invoice for March is here ${"and more text ".repeat(10)}`

  it("starts shortly before the match, with ellipses where text was cut", () => {
    const out = excerptAround(long, "invoice", 60)
    expect(out.startsWith("…")).toBe(true)
    expect(out.endsWith("…")).toBe(true)
    expect(out).toContain("invoice for March")
    expect(out.length).toBeLessThanOrEqual(64)
  })

  it("starts at the beginning when the match is early or absent", () => {
    expect(excerptAround("Short note about tea", "tea")).toBe("Short note about tea")
    expect(excerptAround("Line one\n\nline   two", "zzz")).toBe("Line one line two")
    expect(excerptAround("", "x")).toBe("")
  })
})
