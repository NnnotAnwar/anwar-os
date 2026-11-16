import { describe, expect, it } from "vitest"
import { clean, decodeEntities, extractMetadata, parseAttributes, sniffCharset } from "./html-meta"

describe("decodeEntities", () => {
  it("decodes named and numeric references", () => {
    expect(decodeEntities("Tom &amp; Jerry &mdash; &#8220;hi&#x201D; &copy;")).toBe("Tom & Jerry — “hi” ©")
  })

  it("leaves unknown and invalid references alone", () => {
    expect(decodeEntities("&bogus; &#0; &#x110000;")).toBe("&bogus; &#0; &#x110000;")
  })
})

describe("clean", () => {
  it("collapses whitespace and strips control characters", () => {
    expect(clean("  a\n\tb \u0007 c  ", 100)).toBe("a b c")
  })

  it("caps the length with an ellipsis", () => {
    expect(clean("abcdefghij", 5)).toBe("abcd…")
  })
})

describe("parseAttributes", () => {
  it("reads quoted, single-quoted and bare values", () => {
    expect(parseAttributes(`<meta property="og:title" content='It&apos;s' data-x=bare async>`)).toEqual({
      property: "og:title",
      content: "It's",
      "data-x": "bare",
      async: "",
    })
  })

  it("keeps the first of duplicate attributes and lower-cases names", () => {
    expect(parseAttributes(`<link REL="icon" rel="other" HREF="/a.png" />`)).toEqual({ rel: "icon", href: "/a.png" })
  })
})

describe("extractMetadata", () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body><title>Not this</title></body></html>`

  it("prefers Open Graph, then the document title", () => {
    const meta = extractMetadata(
      page(`
        <title>Plain title</title>
        <meta property="og:title" content="OG title">
        <meta name="description" content="Plain description">
        <meta property="og:description" content="OG &amp; description">
        <meta property="og:site_name" content="Example">
      `),
      "https://example.com/post",
    )
    expect(meta).toEqual({
      title: "OG title",
      description: "OG & description",
      siteName: "Example",
      faviconUrl: "https://example.com/favicon.ico",
    })
  })

  it("falls back to <title> and meta description", () => {
    const meta = extractMetadata(page(`<TITLE> Hello\n  world </TITLE><meta content="Desc" name="Description">`), "https://example.com/")
    expect(meta.title).toBe("Hello world")
    expect(meta.description).toBe("Desc")
  })

  it("resolves the best icon against the page and <base>", () => {
    const html = page(`
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" sizes="16x16" href="/16.png">
      <link rel="icon" sizes="32x32" href="icons/32.png">
    `)
    expect(extractMetadata(html, "https://example.com/blog/post").faviconUrl).toBe(
      "https://example.com/blog/icons/32.png",
    )
    const withBase = page(`<base href="https://cdn.example.net/assets/"><link rel="shortcut icon" href="fav.ico">`)
    expect(extractMetadata(withBase, "https://example.com/").faviconUrl).toBe("https://cdn.example.net/assets/fav.ico")
  })

  it("ignores icons with dangerous schemes", () => {
    const html = page(`<link rel="icon" href="javascript:alert(1)"><link rel="icon" href="data:image/png;base64,AAAA">`)
    expect(extractMetadata(html, "https://example.com/").faviconUrl).toBe("https://example.com/favicon.ico")
  })

  it("ignores tag-like text inside comments and scripts", () => {
    const html = page(`
      <!-- <title>Commented</title> -->
      <script>document.write('<meta property="og:title" content="Scripted">')</script>
      <title>Real</title>
    `)
    expect(extractMetadata(html, "https://example.com/").title).toBe("Real")
  })

  it("returns empty strings when there is nothing to find", () => {
    expect(extractMetadata("<html><body>hi</body></html>", "https://example.com/")).toEqual({
      title: "",
      description: "",
      siteName: "",
      faviconUrl: "https://example.com/favicon.ico",
    })
  })

  it("caps very long values", () => {
    const meta = extractMetadata(page(`<title>${"t".repeat(1000)}</title>`), "https://example.com/")
    expect(meta.title.length).toBe(300)
  })
})

describe("sniffCharset", () => {
  it("reads both meta forms", () => {
    expect(sniffCharset(`<meta charset="windows-1251">`)).toBe("windows-1251")
    expect(sniffCharset(`<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-2">`)).toBe("iso-8859-2")
    expect(sniffCharset(`<title>x</title>`)).toBeUndefined()
  })
})
