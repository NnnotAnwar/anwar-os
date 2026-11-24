import { describe, expect, it } from "vitest"
import { readingMinutes } from "./reading"

describe("readingMinutes", () => {
  it("is 0 for an empty body and at least 1 otherwise", () => {
    expect(readingMinutes("")).toBe(0)
    expect(readingMinutes("Hello")).toBe(1)
    expect(readingMinutes("word ".repeat(1100))).toBe(5)
  })
})
