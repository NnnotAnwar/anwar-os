// Splitting a captured blob into text + link, and the bits other modules need.
// Pure and client-safe.

const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/i

export type Capture = { text: string; url: string | null }

/**
 * Pulls the first web link out of `text` when no URL was given separately:
 * "Read this https://x.dev/a" → { text: "Read this", url: "https://x.dev/a" }.
 */
export function splitCapture(text: string, url?: string | null): Capture {
  const clean = text.replace(/\r\n?/g, "\n").trim()
  if (url) return { text: clean, url: url.trim() }
  const match = URL_RE.exec(clean)
  if (!match) return { text: clean, url: null }
  const rest = (clean.slice(0, match.index) + clean.slice(match.index + match[0].length))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
  return { text: rest, url: match[0] }
}

/** First line as a title (trimmed to `max`), the rest as a body. */
export function titleAndBody(text: string, max: number): { title: string; body: string } {
  const lines = text.trim().split("\n")
  const first = (lines[0] ?? "").trim()
  const rest = lines.slice(1).join("\n").trim()
  if (first.length <= max) return { title: first, body: rest }
  // Break at a word near the limit and carry the remainder into the body.
  const cut = first.lastIndexOf(" ", max - 1)
  const at = cut > max * 0.6 ? cut : max - 1
  const title = `${first.slice(0, at).trimEnd()}…`
  return { title, body: [first, rest].filter(Boolean).join("\n\n") }
}

/** "example.com" for a link chip. */
export function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}
