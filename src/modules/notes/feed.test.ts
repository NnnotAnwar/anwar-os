import { describe, expect, it } from "vitest"
import { atomFeed, escapeXml, FEED_LIMIT, noteHtml, rssFeed } from "./feed"
import type { PublicNote } from "./schema"

const site = new URL("https://anwar.example")

function note(n: number, extra: Partial<PublicNote> = {}): PublicNote {
  return {
    id: `id-${n}`,
    title: `Note ${n}`,
    slug: `note-${n}`,
    excerpt: "",
    body: `Body of note ${n}.`,
    publishedAt: new Date(Date.UTC(2026, 10, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 10, n, 12)).toISOString(),
    ...extra,
  }
}

describe("escapeXml", () => {
  it("escapes markup and drops characters XML forbids", () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>\u0007`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;")
  })
})

describe("noteHtml", () => {
  it("renders markdown safely, with same-site links made absolute", () => {
    const html = noteHtml("Read the [CV](/cv) <script>alert(1)</script>", "https://anwar.example")
    expect(html).toContain('href="https://anwar.example/cv"')
    expect(html).not.toContain("<script>")
  })
})

describe("rssFeed", () => {
  const xml = rssFeed({
    site,
    notes: [note(2, { title: "Fish & <chips>", excerpt: "A summary." }), note(1, { body: "ends ]]> here" })],
  })

  it("is RSS 2.0 with a self link and absolute item URLs from the given origin", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<atom:link href="https://anwar.example/writing/feed.xml" rel="self" type="application/rss+xml"/>')
    expect(xml).toContain("<link>https://anwar.example/writing/note-2</link>")
    expect(xml).toContain('<guid isPermaLink="true">https://anwar.example/writing/note-1</guid>')
    expect(xml).not.toContain("localhost")
  })

  it("escapes titles, uses the excerpt as the description and keeps CDATA intact", () => {
    expect(xml).toContain("<title>Fish &amp; &lt;chips&gt;</title>")
    expect(xml).toContain("<description>A summary.</description>")
    expect(xml).toContain("<description>ends ]]&gt; here</description>")
    // The HTML is escaped by the renderer, so a CDATA terminator can't sneak in.
    expect(xml).toContain("<content:encoded><![CDATA[<p>ends ]]&gt; here</p>")
    expect(xml).toContain(`<pubDate>${new Date(Date.UTC(2026, 10, 2)).toUTCString()}</pubDate>`)
  })

  it("keeps the newest entries only", () => {
    const many = rssFeed({ site, notes: Array.from({ length: FEED_LIMIT + 5 }, (_, i) => note(i + 1)) })
    expect(many.match(/<item>/g)).toHaveLength(FEED_LIMIT)
  })
})

describe("atomFeed", () => {
  it("is Atom 1.0 with ids, dates and escaped HTML content", () => {
    const xml = atomFeed({ site, notes: [note(3, { body: "**bold**" })] })
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"')
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://anwar.example/writing/atom.xml"/>')
    expect(xml).toContain("<id>https://anwar.example/writing/note-3</id>")
    expect(xml).toContain(`<updated>${new Date(Date.UTC(2026, 10, 3, 12)).toISOString()}</updated>`)
    expect(xml).toContain('<content type="html">&lt;p&gt;&lt;strong&gt;bold&lt;/strong&gt;&lt;/p&gt;')
  })
})
