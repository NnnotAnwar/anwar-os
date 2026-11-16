import { describe, expect, it } from "vitest"
import { likeContains } from "./sql-like"

describe("likeContains", () => {
  it("wraps plain text in a contains pattern", () => {
    expect(likeContains("budget")).toBe("%budget%")
  })

  it("escapes LIKE wildcards and the escape character", () => {
    expect(likeContains("50%_off")).toBe(String.raw`%50\%\_off%`)
    expect(likeContains(String.raw`C:\temp`)).toBe(String.raw`%C:\\temp%`)
  })

  it("leaves quotes and punctuation alone (they are bound parameters)", () => {
    expect(likeContains(`a,b(c)"'`)).toBe(`%a,b(c)"'%`)
  })
})
