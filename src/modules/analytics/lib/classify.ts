// What a page-view beacon is reduced to before anything is stored. Pure, so it
// is unit tested. Nothing here keeps the user agent, the address or any id:
// each function returns a coarse class or null ("don't count this").

import type { AnalyticsDevice } from "@/db/schema/analytics"

/** Crawlers, previews, monitors, headless browsers and HTTP libraries. */
const BOT =
  /bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|facebookcatalog|embedly|quora link preview|whatsapp|telegram|discord|slack|skype|vkshare|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|statuscake|curl|wget|python|httpclient|http-client|okhttp|go-http|java\/|libwww|node-fetch|undici|axios|postman|insomnia|phantomjs|selenium|puppeteer|playwright|scrapy|feedfetcher|rss|validator|ahrefs|semrush|mj12|dotbot|petalbot|yandex|baidu|bingpreview|duckduck|applebot|gptbot|claude|anthropic|perplexity|ccbot|bytespider/i

/** True for anything that isn't a person's browser, including no user agent at all. */
export function isBot(userAgent: string | null | undefined) {
  const ua = (userAgent ?? "").trim()
  if (ua.length < 20 || !/^Mozilla\/5\.0 /.test(ua)) return true
  return BOT.test(ua)
}

/** Desktop, mobile or tablet, from the user agent. The string itself is never stored. */
export function deviceClass(userAgent: string): AnalyticsDevice {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(userAgent)) return "tablet"
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(userAgent)) return "mobile"
  return "desktop"
}

/** Do Not Track or Global Privacy Control: the visitor asked not to be counted. */
export function optedOut(headers: Headers) {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1"
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SECTIONS = new Set(["/", "/cv", "/projects", "/ideas", "/links", "/tools", "/feedback", "/writing", "/contact"])

/**
 * The public route a beacon reports, or null when it isn't one we count:
 * a section, a known tool, or a project / note slug (whether that slug is
 * published is checked by app.record_page_view()). Query and hash are dropped.
 */
export function normalizePath(raw: unknown, toolSlugs: readonly string[]): string | null {
  if (typeof raw !== "string" || raw.length > 200 || !raw.startsWith("/") || raw.startsWith("//")) return null
  let path = raw.split(/[?#]/, 1)[0]!
  if (path.length > 1) path = path.replace(/\/+$/, "")
  if (SECTIONS.has(path)) return path
  const [, section, slug, ...rest] = path.split("/")
  if (rest.length > 0 || !slug || slug.length > 80) return null
  if (section === "tools") return toolSlugs.includes(slug) ? path : null
  if ((section === "projects" || section === "writing") && SLUG.test(slug)) return path
  return null
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

/**
 * The referring site's host ("news.ycombinator.com"), or "" for direct visits,
 * internal navigation, non-web referrers and anything malformed. Path and
 * query of the referrer are never kept.
 */
export function referrerHost(raw: unknown, ownHosts: readonly string[]): string {
  if (typeof raw !== "string" || !raw || raw.length > 2000) return ""
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ""
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return ""
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "")
  const own = ownHosts.map((h) => h.toLowerCase().replace(/^www\./, ""))
  if (own.includes(host)) return ""
  return host.length <= 253 && HOSTNAME.test(host) ? host : ""
}

/** Country code an edge proxy may add (Cloudflare and friends); "" when there is none. */
export function countryFrom(headers: Headers): string {
  for (const name of ["cf-ipcountry", "x-vercel-ip-country", "x-country-code"]) {
    const value = headers.get(name)?.trim().toUpperCase()
    if (value && /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value
  }
  return ""
}

/**
 * A fixed-window counter per key, in this process's memory only (never written
 * anywhere, gone on restart). Keys are salted hashes, so even the memory holds
 * no address.
 */
export function createLimiter({ max, windowMs, now = () => Date.now() }: { max: number; windowMs: number; now?: () => number }) {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    take(key: string) {
      const t = now()
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k)
      }
      const w = windows.get(key)
      if (!w || t - w.start >= windowMs) {
        windows.set(key, { start: t, count: 1 })
        return true
      }
      w.count += 1
      return w.count <= max
    },
  }
}
