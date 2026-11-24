// RSS 2.0 and Atom 1.0 for /writing. Pure string builders, so they're unit
// tested; the route handlers pass the request-time site origin (never the
// build's placeholder) and the published notes.
import { renderMarkdown } from "@/modules/files/lib/markdown"
import { summaryOf, type PublicNote } from "./schema"

export const FEED_TITLE = "Anwar — Writing"
export const FEED_DESCRIPTION = "Notes Anwar chose to publish: building, studying and self-hosting."
/** Newest entries in a feed. */
export const FEED_LIMIT = 20

export function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Characters XML 1.0 forbids outright.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
}

function cdata(text: string) {
  return `<![CDATA[${text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`
}

/** The note as HTML for readers, with same-site links and images made absolute. */
export function noteHtml(body: string, origin: string) {
  return renderMarkdown(body).replace(/(href|src)="\/(?!\/)/g, `$1="${origin}/`)
}

type FeedInput = { notes: PublicNote[]; site: URL }

function entries({ notes, site }: FeedInput) {
  return notes.slice(0, FEED_LIMIT).map((note) => ({
    note,
    url: new URL(`/writing/${note.slug}`, site).toString(),
    summary: summaryOf(note),
    html: noteHtml(note.body, site.origin),
  }))
}

function newest(notes: PublicNote[]) {
  const times = notes.map((n) => Date.parse(n.updatedAt))
  return new Date(times.length ? Math.max(...times) : 0)
}

export function rssFeed(input: FeedInput) {
  const { site, notes } = input
  const home = new URL("/writing", site).toString()
  const self = new URL("/writing/feed.xml", site).toString()
  const items = entries(input).map(
    ({ note, url, summary, html }) => `    <item>
      <title>${escapeXml(note.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(note.publishedAt).toUTCString()}</pubDate>
      <description>${escapeXml(summary)}</description>
      <content:encoded>${cdata(html)}</content:encoded>
    </item>`,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${escapeXml(home)}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en</language>
${notes.length ? `    <lastBuildDate>${newest(notes).toUTCString()}</lastBuildDate>\n` : ""}    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>
${items.join("\n")}
  </channel>
</rss>
`
}

export function atomFeed(input: FeedInput) {
  const { site, notes } = input
  const home = new URL("/writing", site).toString()
  const self = new URL("/writing/atom.xml", site).toString()
  const items = entries(input).map(
    ({ note, url, summary, html }) => `  <entry>
    <title>${escapeXml(note.title)}</title>
    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>
    <id>${escapeXml(url)}</id>
    <published>${new Date(note.publishedAt).toISOString()}</published>
    <updated>${new Date(note.updatedAt).toISOString()}</updated>
    <summary>${escapeXml(summary)}</summary>
    <content type="html">${escapeXml(html)}</content>
  </entry>`,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>${escapeXml(FEED_TITLE)}</title>
  <subtitle>${escapeXml(FEED_DESCRIPTION)}</subtitle>
  <link rel="alternate" type="text/html" href="${escapeXml(home)}"/>
  <link rel="self" type="application/atom+xml" href="${escapeXml(self)}"/>
  <id>${escapeXml(home)}</id>
  <updated>${newest(notes).toISOString()}</updated>
  <author><name>Anwar</name></author>
${items.join("\n")}
</feed>
`
}
