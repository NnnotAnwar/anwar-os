/**
 * CSRF guard for JSON route handlers that act on the session cookie (the
 * offline sync API, src/core/offline-sync.ts). Pure, so it's unit-tested.
 *
 * A request passes when
 *   - the browser says it came from this site (Sec-Fetch-Site: same-origin,
 *     when the header is sent; every current browser sends it), and
 *   - its Origin is the site's own: BETTER_AUTH_URL's origin, or the origin
 *     the request was addressed to (Host / X-Forwarded-Host behind Caddy), and
 *   - it is JSON, which a cross-site <form> can't send without a preflight.
 *
 * Better Auth's cookie is SameSite=Lax as well, so a cross-site POST carries no
 * session in the first place; this is the second lock on the door.
 */
export type OriginVerdict = { ok: true } | { ok: false; reason: string }

function originOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

/** The origins this request may come from: the configured site and the address it was sent to. */
export function allowedOrigins(headers: Headers, requestUrl: string, siteUrl?: string): Set<string> {
  const allowed = new Set<string>()
  const site = originOf(siteUrl)
  if (site) allowed.add(site)
  const url = originOf(requestUrl)
  if (url) allowed.add(url)
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host")
  if (host) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(requestUrl).protocol.replace(":", "")
    const forwarded = originOf(`${proto}://${host}`)
    if (forwarded) allowed.add(forwarded)
  }
  return allowed
}

export function checkSameOrigin(headers: Headers, requestUrl: string, siteUrl?: string): OriginVerdict {
  const fetchSite = headers.get("sec-fetch-site")
  if (fetchSite && fetchSite !== "same-origin") return { ok: false, reason: `sec-fetch-site ${fetchSite}` }

  const origin = headers.get("origin")
  if (!origin) return { ok: false, reason: "no origin" }
  if (!allowedOrigins(headers, requestUrl, siteUrl).has(origin)) return { ok: false, reason: `origin ${origin}` }

  const type = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (type !== "application/json") return { ok: false, reason: `content-type ${type ?? "none"}` }
  return { ok: true }
}
