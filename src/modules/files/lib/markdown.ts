// Markdown → safe HTML for knowledge-base documents. Safety comes from three
// rules, each covered by tests: raw HTML in the source is escaped (html: false),
// links and images only keep http(s), mailto and relative URLs, and external
// links open in a new tab without an opener or referrer.

import MarkdownIt from "markdown-it"

const SAFE_URL = /^(https?:|mailto:)/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Allows http(s), mailto, and scheme-less (relative, #anchor) URLs only. */
export function isSafeUrl(url: string) {
  // Browsers ignore control characters and whitespace inside a scheme
  // ("java\tscript:"), so judge the URL with them removed.
  // eslint-disable-next-line no-control-regex
  const compact = url.replace(/[\u0000- \u007f]/g, "")
  if (SAFE_URL.test(compact)) return true
  if (compact.startsWith("//")) return false
  return !HAS_SCHEME.test(compact)
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false })
md.validateLink = isSafeUrl

const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!
  const href = token.attrGet("href") ?? ""
  if (/^https?:/i.test(href)) {
    token.attrSet("target", "_blank")
    token.attrSet("rel", "noopener noreferrer nofollow")
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const defaultImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!
  token.attrSet("loading", "lazy")
  token.attrSet("referrerpolicy", "no-referrer")
  return defaultImage(tokens, idx, options, env, self)
}

export function renderMarkdown(source: string) {
  return md.render(source)
}

/** Plain text for previews and search snippets: markup stripped, whitespace collapsed. */
export function markdownToText(source: string) {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
