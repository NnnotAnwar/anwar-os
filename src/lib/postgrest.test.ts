import { describe, expect, it } from "vitest"
import { ilikeContains } from "./postgrest"

describe("ilikeContains", () => {
  it("wraps plain text in a quoted contains pattern", () => {
    expect(ilikeContains("budget")).toBe('"%budget%"')
  })

  it("keeps filter syntax characters inside the quotes", () => {
    expect(ilikeContains("a,b(c)")).toBe('"%a,b(c)%"')
  })

  it("escapes LIKE wildcards and quotes", () => {
    expect(ilikeContains("50%_off")).toBe(String.raw`"%50\\%\\_off%"`)
    expect(ilikeContains('say "hi"')).toBe(String.raw`"%say \"hi\"%"`)
  })
})
