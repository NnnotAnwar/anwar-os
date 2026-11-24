// Text helpers for global search: highlighting and excerpts. Pure, so the same
// code runs in providers (server), the search UI (client) and unit tests.

export type TextPart = { text: string; match: boolean }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * What to look for in a piece of text: the whole query first, then each word of
 * two or more characters, longest first (so "coffee beans" marks the phrase when
 * it's there and the words when they're apart).
 */
export function queryTerms(query: string): string[] {
  const phrase = query.trim().replace(/\s+/g, " ")
  if (!phrase) return []
  const words = phrase.split(" ").filter((w) => w.length >= 2)
  return [...new Set([phrase, ...words].map((t) => t.toLocaleLowerCase()))].sort((a, b) => b.length - a.length)
}

function termPattern(query: string): RegExp | null {
  const terms = queryTerms(query)
  return terms.length ? new RegExp(terms.map(escape).join("|"), "giu") : null
}

/** Splits `text` into plain and matching parts, case-insensitively, keeping the original spelling. */
export function highlightParts(text: string, query: string): TextPart[] {
  const pattern = termPattern(query)
  if (!text) return []
  if (!pattern) return [{ text, match: false }]
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(pattern)) {
    if (!m[0]) continue
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false })
    parts.push({ text: m[0], match: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false })
  return parts
}

/** True when `text` contains the query (or, failing that, every one of its words). */
export function matches(text: string | null | undefined, query: string): boolean {
  if (!text) return false
  const hay = text.toLocaleLowerCase()
  const phrase = query.trim().replace(/\s+/g, " ").toLocaleLowerCase()
  if (!phrase) return false
  if (hay.includes(phrase)) return true
  const words = phrase.split(" ").filter((w) => w.length >= 2)
  return words.length > 1 && words.every((w) => hay.includes(w))
}

/**
 * A compact date for result metadata: "12 Nov" this year, "12 Nov 2025" otherwise.
 * `day` is an ISO date ("2026-11-12", read as a calendar day) or an instant.
 */
export function shortDate(day: string | Date, { locale, timeZone, now = new Date() }: { locale: string; timeZone: string; now?: Date }) {
  const calendarDay = typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
  const date = calendarDay ? new Date(`${day}T12:00:00Z`) : new Date(day)
  if (Number.isNaN(date.getTime())) return ""
  const zone = calendarDay ? "UTC" : timeZone
  const year = (d: Date, z: string) => new Intl.DateTimeFormat("en", { year: "numeric", timeZone: z }).format(d)
  const sameYear = year(date, zone) === year(now, timeZone)
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: zone,
  }).format(date)
}

/**
 * A one-line excerpt of `text` (whitespace collapsed) of about `length`
 * characters, starting a little before the first match so it shows why the item
 * was found. Without a match it's the beginning of the text.
 */
export function excerptAround(text: string | null | undefined, query: string, length = 90): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim()
  if (!flat) return ""
  const pattern = termPattern(query)
  const at = pattern ? flat.search(pattern) : -1
  let start = at > 30 ? at - 30 : 0
  // Start on a word boundary rather than mid-word.
  if (start > 0) {
    const space = flat.lastIndexOf(" ", start)
    start = space > at - 45 && space >= 0 ? space + 1 : start
  }
  const end = Math.min(flat.length, start + length)
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`
}
