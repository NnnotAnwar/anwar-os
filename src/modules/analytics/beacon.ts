import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { sql } from "drizzle-orm"
import { getSessionCookie } from "better-auth/cookies"
import { getViewer } from "@/core/auth"
import { asPublic } from "@/db"
import { clientIp } from "@/lib/rate-limit"
import { getSiteUrl } from "@/lib/site"
import { TOOLS } from "@/modules/tools/catalog"
import { countryFrom, createLimiter, deviceClass, isBot, normalizePath, optedOut, referrerHost } from "./lib/classify"

// POST /api/a: one page view from the public site's beacon
// (components/page-view-beacon.tsx). No cookies are read or set for visitors,
// and nothing that identifies one is stored: the request is reduced to
// (path, referrer host, device class, country) and counted for the day by
// app.record_page_view(), which validates it again and keeps a global budget.
//
// The answer is always 204 with no body, so it tells a sender nothing about
// what was counted. Dropped: Do-Not-Track / GPC, bots, cross-site posts,
// unknown paths, more than 60 a minute from one client, and the owner (a
// signed-in session) browsing their own site.

const TOOL_SLUGS = TOOLS.map((t) => t.slug)
const MAX_BODY = 2048

// Per-client limit, in memory only. The key is the client address hashed with a
// salt that lives and dies with this process, so it can't be reversed or joined.
const salt = randomBytes(16)
const limiter = createLimiter({ max: 60, windowMs: 60_000 })
const clientKey = (headers: Headers) => createHash("sha256").update(salt).update(clientIp(headers)).digest("hex")

const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })

export async function beaconPOST(request: Request) {
  const headers = request.headers
  if (optedOut(headers)) return done()
  const userAgent = headers.get("user-agent") ?? ""
  if (isBot(userAgent)) return done()
  // Browsers mark their own requests; a beacon always comes from our own pages.
  const fetchSite = headers.get("sec-fetch-site")
  if (fetchSite && fetchSite !== "same-origin") return done()
  if (Number(headers.get("content-length") ?? 0) > MAX_BODY) return done()

  let body: { p?: unknown; r?: unknown }
  try {
    const text = await request.text()
    if (text.length > MAX_BODY) return done()
    body = JSON.parse(text) as typeof body
  } catch {
    return done()
  }
  if (!body || typeof body !== "object") return done()

  const path = normalizePath(body.p, TOOL_SLUGS)
  if (!path) return done()
  if (!limiter.take(clientKey(headers))) return done()

  try {
    // The owner reading their own site isn't a visitor. Only a request that
    // carries a session cookie costs a session lookup.
    if (getSessionCookie(headers) && (await getViewer())) return done()

    const ownHosts = [getSiteUrl().hostname, headers.get("host")?.split(":")[0] ?? ""].filter(Boolean)
    await asPublic((tx) =>
      tx.execute(sql`select app.record_page_view(
        ${path},
        ${referrerHost(body.r, ownHosts)},
        ${deviceClass(userAgent)},
        ${countryFrom(headers)}
      )`),
    )
  } catch (error) {
    // Counting is best effort; a visitor never sees an error for it.
    console.warn("analytics: page view not counted", error instanceof Error ? error.message : error)
  }
  return done()
}
