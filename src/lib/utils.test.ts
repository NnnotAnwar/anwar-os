import { describe, expect, it } from "vitest"
import { cn } from "./utils"

describe("cn", () => {
  it("keeps type styles next to text colours", () => {
    expect(cn("text-caption bg-track text-foreground")).toBe("text-caption bg-track text-foreground")
    expect(cn("text-meta", "text-muted-foreground")).toBe("text-meta text-muted-foreground")
  })

  it("still lets a later font size win", () => {
    expect(cn("text-sm", "text-meta")).toBe("text-meta")
    expect(cn("text-meta", "text-lg")).toBe("text-lg")
  })
})
