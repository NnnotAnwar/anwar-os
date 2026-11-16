import { describe, expect, it } from "vitest"
import { createLinkInput, domainOf, fallbackTitle, normalizeTag, normalizeUrl, parseTags } from "./schema"

describe("normalizeUrl", () => {
  it.each([
    ["https://react.dev/learn", "https://react.dev/learn"],
    ["  react.dev/learn ", "https://react.dev/learn"],
    ["example.com", "https://example.com/"],
    ["HTTP://Example.COM/A", "http://example.com/A"],
    ["//example.com/x", "https://example.com/x"],
  ])("normalizes %j", (raw, expected) => expect(normalizeUrl(raw)).toBe(expected))

  it.each(["", "   ", "not a url", "javascript:alert(1)", "ftp://example.com", "mailto:a@b.c", "https://user:pw@example.com", "hello"])(
    "rejects %j",
    (raw) => expect(normalizeUrl(raw)).toBeNull(),
  )
})

describe("tags", () => {
  it("normalizes one tag", () => {
    expect(normalizeTag("  #Next JS ")).toBe("next-js")
    expect(normalizeTag("Č-ŘÍ_web!")).toBe("č-ří-web")
    expect(normalizeTag("###")).toBe("")
  })

  it("parses a free-form list, unique and capped", () => {
    expect(parseTags("React, #tools  ui,react")).toEqual(["react", "tools", "ui"])
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20)
  })
})

describe("display helpers", () => {
  it("shows the bare domain", () => {
    expect(domainOf("https://www.example.com/a")).toBe("example.com")
  })

  it("builds a title from the URL", () => {
    expect(fallbackTitle("https://www.example.com/docs/intro/")).toBe("example.com/docs/intro")
  })
})

describe("createLinkInput", () => {
  it("explains how to fix a bad URL", () => {
    const result = createLinkInput.safeParse({ url: "nope" })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/e\.g\. https:\/\//)
  })

  it("fills defaults", () => {
    expect(createLinkInput.parse({ url: "example.com", tags: "a b" })).toEqual({
      url: "https://example.com/",
      tags: ["a", "b"],
      note: "",
      isPublic: false,
      readLater: false,
    })
  })
})
