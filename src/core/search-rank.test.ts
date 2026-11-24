import { describe, expect, it } from "vitest"
import { rankGroups, rankHits, scoreHit, type SearchHit } from "./search-rank"

const hit = (title: string, extra: Partial<SearchHit> = {}): SearchHit => ({ id: title, title, href: "/app", ...extra })

describe("scoreHit", () => {
  it("orders exact, prefix, word, substring, snippet and body matches", () => {
    const q = "tea"
    const scores = [
      scoreHit(q, hit("Tea")),
      scoreHit(q, hit("Tea with Petra")),
      scoreHit(q, hit("Green tea")),
      scoreHit(q, hit("Steam room")),
      scoreHit(q, hit("Shopping", { snippet: "milk, tea" })),
      scoreHit(q, hit("Shopping")),
    ]
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(new Set(scores).size).toBe(scores.length)
  })

  it("ignores case and extra spaces", () => {
    expect(scoreHit("  TEA ", hit("tea"))).toBe(100)
  })

  it("counts a title holding every word of the query", () => {
    expect(scoreHit("dentist monday", hit("Monday: dentist"))).toBeGreaterThan(scoreHit("dentist monday", hit("Monday")))
  })

  it("scores amounts and metadata above a hidden body match", () => {
    expect(scoreHit("250", hit("Coffee", { aside: "−250,00 Kč" }))).toBeGreaterThan(scoreHit("250", hit("Coffee")))
    expect(scoreHit("work", hit("Call", { meta: ["Work"] }))).toBeGreaterThan(scoreHit("work", hit("Call")))
  })

  it("is zero for an empty query", () => {
    expect(scoreHit("", hit("x"))).toBe(0)
  })
})

describe("rankHits", () => {
  it("puts better matches first and keeps the module's order on ties", () => {
    const hits = [hit("Shopping", { snippet: "tea" }), hit("Green tea"), hit("Black tea"), hit("Tea")]
    expect(rankHits("tea", hits).map((h) => h.title)).toEqual(["Tea", "Green tea", "Black tea", "Shopping"])
  })
})

describe("rankGroups", () => {
  it("orders groups by their best hit, then by registry order", () => {
    const groups = [
      { moduleId: "tasks", hits: [hit("Buy tea", { snippet: "x" })] },
      { moduleId: "notes", hits: [hit("Tea")] },
      { moduleId: "links", hits: [hit("Buy tea")] },
    ]
    expect(rankGroups("tea", groups).map((g) => g.moduleId)).toEqual(["notes", "tasks", "links"])
  })
})
