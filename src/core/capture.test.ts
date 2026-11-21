import { describe, expect, it } from "vitest"
import { bodyFor, captureDestinations, inboxText, parseShared, titleFor } from "./capture"

describe("parseShared", () => {
  it("pulls the URL out of Android's text field", () => {
    expect(parseShared({ text: "Great read https://example.com/post?id=1" })).toEqual({
      title: "Great read",
      text: "",
      url: "https://example.com/post?id=1",
    })
  })

  it("drops a URL that iOS repeats in the text", () => {
    expect(parseShared({ title: "Example", text: "https://example.com/", url: "https://example.com/" })).toEqual({
      title: "Example",
      text: "",
      url: "https://example.com/",
    })
  })

  it("keeps plain text as a note body and ignores non-http URLs", () => {
    const draft = parseShared({ text: "line one\nline two", url: "javascript:alert(1)" })
    expect(draft).toEqual({ title: "", text: "line one\nline two", url: "" })
  })

  it("strips trailing punctuation from a URL found in text", () => {
    expect(parseShared({ text: "see (https://example.com/a)." }).url).toBe("https://example.com/a")
  })

  it("takes the first value of repeated params", () => {
    expect(parseShared({ title: ["a", "b"] }).title).toBe("a")
  })
})

describe("destinations", () => {
  it("default to the inbox", () => {
    expect(captureDestinations[0].id).toBe("inbox")
  })

  it("give the inbox the title as the first line", () => {
    expect(inboxText({ title: "Read this", text: "later", url: "https://a.b/" })).toBe("Read this\nlater")
    expect(inboxText({ title: "", text: "", url: "https://a.b/" })).toBe("")
  })
})

describe("titleFor / bodyFor", () => {
  it("uses the title when there is one and keeps the URL in the body", () => {
    const d = { title: "T", text: "body", url: "https://a.b/" }
    expect(titleFor(d)).toBe("T")
    expect(bodyFor(d)).toBe("body\n\nhttps://a.b/")
  })

  it("promotes the first short line to the title", () => {
    const d = { title: "", text: "Buy milk\nand bread", url: "" }
    expect(titleFor(d)).toBe("Buy milk")
    expect(bodyFor(d)).toBe("and bread")
  })

  it("keeps a long first line in the body", () => {
    const long = "x".repeat(100)
    const d = { title: "", text: long, url: "" }
    expect(titleFor(d)).toHaveLength(80)
    expect(bodyFor(d)).toBe(long)
  })

  it("falls back to the host name", () => {
    expect(titleFor({ title: "", text: "", url: "https://www.example.com/x" })).toBe("example.com")
  })
})
