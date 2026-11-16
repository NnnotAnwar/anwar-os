import { describe, expect, it } from "vitest"
import { buildStorageKey, contentDisposition, isOwnedKey } from "./keys"
import { isSafeUrl, markdownToText, renderMarkdown } from "./markdown"
import {
  checkUpload,
  cleanFileName,
  formatBytes,
  MAX_UPLOAD_BYTES,
  normalizeTags,
  previewKind,
  resolveMime,
} from "./validation"

const id = "0d3f6b1e-8a3c-4b7e-9f10-2a6c1d5e7b90"

describe("storage keys", () => {
  it("puts objects under the owner's prefix", () => {
    expect(buildStorageKey("user123", id)).toBe(`user123/${id}`)
  })

  it("refuses owner ids or object ids that could escape the prefix", () => {
    expect(() => buildStorageKey("a/b", id)).toThrow()
    expect(() => buildStorageKey("", id)).toThrow()
    expect(() => buildStorageKey("user123", "../etc/passwd")).toThrow()
    expect(() => buildStorageKey("user123", `${id}/x`)).toThrow()
  })

  it("recognises only keys issued to that owner", () => {
    expect(isOwnedKey("user123", `user123/${id}`)).toBe(true)
    expect(isOwnedKey("user12", `user123/${id}`)).toBe(false)
    expect(isOwnedKey("user123", `user1234/${id}`)).toBe(false)
    expect(isOwnedKey("user123", `user123/${id}/../other`)).toBe(false)
    expect(isOwnedKey("user123", `other/${id}`)).toBe(false)
  })
})

describe("contentDisposition", () => {
  it("keeps a UTF-8 name and an ASCII fallback", () => {
    expect(contentDisposition("Daňové přiznání.pdf", "attachment")).toBe(
      `attachment; filename="Danove priznani.pdf"; filename*=UTF-8''Da%C5%88ov%C3%A9%20p%C5%99izn%C3%A1n%C3%AD.pdf`,
    )
  })

  it("can't be broken out of with quotes", () => {
    expect(contentDisposition('a"; evil=1.txt', "inline")).toMatch(/^inline; filename="a_; evil=1.txt"; filename\*=/)
  })
})

describe("upload validation", () => {
  it("accepts allowlisted types and resolves empty types by extension", () => {
    expect(resolveMime("scan.pdf", "application/pdf")).toBe("application/pdf")
    expect(resolveMime("notes.md", "")).toBe("text/markdown")
    expect(resolveMime("photo.JPG", "application/octet-stream")).toBe("image/jpeg")
    expect(resolveMime("old.zip", "application/x-zip-compressed")).toBe("application/zip")
  })

  it("refuses types outside the allowlist, even with an allowed extension", () => {
    expect(resolveMime("page.html", "text/html")).toBeNull()
    expect(resolveMime("tool.exe", "")).toBeNull()
    expect(resolveMime("fake.pdf", "application/x-msdownload")).toBeNull()
    expect(resolveMime("noext", "")).toBeNull()
  })

  it("enforces the 100 MB limit", () => {
    expect(checkUpload({ name: "big.zip", size: MAX_UPLOAD_BYTES, type: "application/zip" })).toEqual({
      ok: true,
      mime: "application/zip",
    })
    expect(checkUpload({ name: "huge.zip", size: MAX_UPLOAD_BYTES + 1, type: "application/zip" }).ok).toBe(false)
  })

  it("cleans file names", () => {
    expect(cleanFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf")
    expect(cleanFileName("../../etc/passwd")).toBe("passwd")
    expect(cleanFileName("  a\u0000b\nc.txt ")).toBe("abc.txt")
    expect(cleanFileName("..")).toBe("Untitled")
    const long = cleanFileName(`${"x".repeat(300)}.pdf`)
    expect(long).toHaveLength(255)
    expect(long.endsWith(".pdf")).toBe(true)
  })

  it("normalizes tags", () => {
    expect(normalizeTags("Tax, 2026 ,tax,, Receipts ")).toEqual(["tax", "2026", "receipts"])
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20)
  })

  it("previews only images and PDFs, never SVG", () => {
    expect(previewKind("image/png")).toBe("image")
    expect(previewKind("application/pdf")).toBe("pdf")
    expect(previewKind("image/svg+xml")).toBeNull()
    expect(previewKind("application/zip")).toBeNull()
  })

  it("formats sizes", () => {
    expect(formatBytes(12)).toBe("12 B")
    expect(formatBytes(820 * 1024)).toBe("820 KB")
    expect(formatBytes(1.45 * 1024 * 1024)).toBe("1.4 MB")
  })
})

describe("markdown sanitizer", () => {
  it("renders ordinary markdown", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and `code`.\n\n- one\n- two")
    expect(html).toContain("<h1>Title</h1>")
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("<code>code</code>")
    expect(html).toContain("<li>one</li>")
  })

  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nhi <b onclick="x()">b</b>')
    expect(html).not.toMatch(/<script|<img|<b /i)
    expect(html).toContain("&lt;script&gt;")
  })

  it.each([
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](java\tscript:alert(1))",
    "[x]( javascript:alert(1))",
    "[x](vbscript:msgbox(1))",
    "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "![x](data:image/svg+xml;base64,PHN2Zy8+)",
    "[x](file:///etc/passwd)",
    "<javascript:alert(1)>",
    "[x](//evil.example/path)",
  ])("drops the dangerous link in %s", (source) => {
    const html = renderMarkdown(source)
    expect(html).not.toMatch(/href="\s*(javascript|vbscript|data|file):/i)
    expect(html).not.toMatch(/src="\s*(javascript|data):/i)
    expect(html).not.toMatch(/href="\/\//)
  })

  it("keeps safe links and hardens external ones", () => {
    const html = renderMarkdown("[site](https://example.com) [mail](mailto:a@b.cz) [here](#notes) [rel](./doc)")
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a>')
    expect(html).toContain('<a href="mailto:a@b.cz">mail</a>')
    expect(html).toContain('<a href="#notes">here</a>')
    expect(html).toContain('<a href="./doc">rel</a>')
  })

  it("escapes attribute-breaking characters in URLs and titles", () => {
    const html = renderMarkdown('[x](https://a.example/"onmouseover="alert(1) "t\\"itle")')
    expect(html).not.toMatch(/"\s*onmouseover=/i)
  })

  it("loads images lazily without a referrer", () => {
    expect(renderMarkdown("![cat](https://example.com/cat.png)")).toContain('loading="lazy" referrerpolicy="no-referrer"')
  })

  it("judges URLs on their real scheme", () => {
    expect(isSafeUrl("https://x.cz")).toBe(true)
    expect(isSafeUrl("relative/path")).toBe(true)
    expect(isSafeUrl("java\nscript:alert(1)")).toBe(false)
    expect(isSafeUrl("\u0001javascript:alert(1)")).toBe(false)
  })

  it("flattens markdown to text for snippets", () => {
    expect(markdownToText("# Plan\n\n- **Buy** [milk](https://x.cz)\n\n```\ncode\n```")).toBe("Plan Buy milk")
  })
})
