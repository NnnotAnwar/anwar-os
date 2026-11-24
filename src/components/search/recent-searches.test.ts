import { describe, expect, it } from "vitest"
import { MAX_RECENT, pushRecent } from "./recent-searches"

describe("pushRecent", () => {
  it("puts the newest first and tidies spaces", () => {
    expect(pushRecent(["tea"], "  coffee   beans ")).toEqual(["coffee beans", "tea"])
  })

  it("moves a repeated query to the front, ignoring case", () => {
    expect(pushRecent(["tea", "Coffee", "rent"], "coffee")).toEqual(["coffee", "tea", "rent"])
  })

  it("keeps at most the limit", () => {
    const many = Array.from({ length: MAX_RECENT }, (_, i) => `q${i}`)
    const next = pushRecent(many, "new")
    expect(next).toHaveLength(MAX_RECENT)
    expect(next[0]).toBe("new")
    expect(next).not.toContain(`q${MAX_RECENT - 1}`)
  })

  it("ignores a blank query", () => {
    expect(pushRecent(["tea"], "   ")).toEqual(["tea"])
  })
})
