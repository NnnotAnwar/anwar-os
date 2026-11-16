import { describe, expect, it } from "vitest"
import { hostOf, splitCapture, titleAndBody } from "./extract"

describe("splitCapture", () => {
  it("pulls the first link out of the text", () => {
    expect(splitCapture("Read this https://example.com/a?b=1 later")).toEqual({
      text: "Read this later",
      url: "https://example.com/a?b=1",
    })
  })

  it("leaves trailing punctuation outside the link", () => {
    expect(splitCapture("See https://example.com/page.").url).toBe("https://example.com/page")
    expect(splitCapture("(https://example.com/x)").url).toBe("https://example.com/x")
  })

  it("keeps a URL that came separately and the text as typed", () => {
    expect(splitCapture("  Shared from Safari ", "https://a.dev")).toEqual({ text: "Shared from Safari", url: "https://a.dev" })
  })

  it("returns plain text untouched", () => {
    expect(splitCapture("Buy milk\nand eggs")).toEqual({ text: "Buy milk\nand eggs", url: null })
  })

  it("handles a bare link", () => {
    expect(splitCapture("https://example.com")).toEqual({ text: "", url: "https://example.com" })
  })
})

describe("titleAndBody", () => {
  it("splits the first line from the rest", () => {
    expect(titleAndBody("Title\nline two\nline three", 200)).toEqual({ title: "Title", body: "line two\nline three" })
  })

  it("shortens a long first line at a word and keeps it whole in the body", () => {
    const long = "word ".repeat(60).trim()
    const { title, body } = titleAndBody(long, 50)
    expect(title.length).toBeLessThanOrEqual(50)
    expect(title.endsWith("…")).toBe(true)
    expect(body).toBe(long)
  })
})

describe("hostOf", () => {
  it("shows the host without www", () => {
    expect(hostOf("https://www.example.com/a")).toBe("example.com")
    expect(hostOf("nonsense")).toBe("nonsense")
  })
})
