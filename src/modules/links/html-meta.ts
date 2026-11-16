// Pulls a link preview out of an HTML document's <head> without a DOM: title,
// description, site name and icon. Tolerant of messy markup; anything missing
// comes back as an empty string.

export type PageMetadata = {
  title: string
  description: string
  siteName: string
  faviconUrl: string
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
}

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED[ref.toLowerCase()] ?? match
  })
}

/** Collapses whitespace, strips control characters and caps the length. */
export function clean(text: string, max: number) {
  const flat = decodeEntities(text).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** Attributes of one start tag, lower-cased names, entity-decoded values. */
export function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  // Skip the tag name.
  const body = tag.replace(/^<\s*[a-z0-9]+/i, "").replace(/\/?>$/, "")
  for (const m of body.matchAll(re)) {
    const name = m[1]!.toLowerCase()
    if (name in attrs) continue
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "")
  }
  return attrs
}

function absolute(href: string, base: URL) {
  try {
    const url = new URL(href.trim(), base)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : ""
  } catch {
    return ""
  }
}

/** The part of the document that holds metadata: up to </head> or <body>. */
function headOf(html: string) {
  const end = html.search(/<\/head\s*>|<body[\s>]/i)
  return end === -1 ? html : html.slice(0, end)
}

export function extractMetadata(html: string, pageUrl: string | URL): PageMetadata {
  const base = new URL(pageUrl)
  // Comments and scripts can contain tag-like text; drop them first.
  const head = headOf(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")

  // A <base href> changes how relative icon URLs resolve.
  const baseTag = head.match(/<base\b[^>]*>/i)
  const baseHref = baseTag ? parseAttributes(baseTag[0]).href : undefined
  const resolveBase = baseHref ? new URL(absolute(baseHref, base) || base.href) : base

  const meta = new Map<string, string>()
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0])
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase()
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content)
  }

  const icons: { href: string; rank: number; size: number }[] = []
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0])
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/)
    if (!attrs.href) continue
    let rank = -1
    if (rel.includes("icon")) rank = 3
    else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) rank = 2
    else if (rel.includes("mask-icon")) rank = 0
    if (rank < 0) continue
    const size = Number(attrs.sizes?.match(/(\d+)x\d+/i)?.[1] ?? 0)
    // A 32px PNG beats a 16px one; SVG and "any" scale to anything.
    const scalable = attrs.type === "image/svg+xml" || attrs.sizes === "any" || /\.svg(\?|$)/i.test(attrs.href)
    icons.push({ href: attrs.href, rank, size: scalable ? 64 : size })
  }
  icons.sort((a, b) => b.rank - a.rank || Math.abs(a.size - 32) - Math.abs(b.size - 32))

  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? ""
  const title = clean(meta.get("og:title") || meta.get("twitter:title") || titleTag, 300)
  const description = clean(
    meta.get("og:description") || meta.get("description") || meta.get("twitter:description") || "",
    1000,
  )
  const siteName = clean(meta.get("og:site_name") || meta.get("application-name") || "", 200)
  const icon = icons.map((i) => absolute(i.href, resolveBase)).find(Boolean)
  const faviconUrl = (icon || new URL("/favicon.ico", base).href).slice(0, 2048)

  return { title, description, siteName, faviconUrl }
}

/** The charset a document declares in its first bytes, if any. */
export function sniffCharset(head: string) {
  const m =
    head.match(/<meta\s+charset\s*=\s*["']?\s*([\w-]+)/i) ??
    head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i)
  return m?.[1]?.toLowerCase()
}
