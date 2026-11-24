import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"
import { contentSecurityPolicy, createNonce } from "@/core/csp"

/**
 * Runs before every page (not static files, not /api):
 *
 * 1. Optimistic gate for /app: no session cookie → /login. This only checks the
 *    cookie is present; the DAL (requireViewer) validates it against the
 *    database, and RLS is the last line.
 * 2. Content-Security-Policy with a fresh nonce. Next.js finds the nonce in the
 *    request's CSP header and adds it to its scripts; layouts read `x-nonce`.
 *    The same policy goes on the response. Other security headers (HSTS,
 *    X-Frame-Options, Permissions-Policy, ...) are set by Caddy: docs/DEPLOY.md.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if ((pathname === "/app" || pathname.startsWith("/app/")) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone()
    url.search = new URLSearchParams({ next: pathname }).toString()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  const nonce = createNonce()
  const csp = contentSecurityPolicy(nonce, {
    nodeEnv: process.env.NODE_ENV,
    siteUrl: process.env.BETTER_AUTH_URL,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE,
  })

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("content-security-policy", csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("content-security-policy", csp)
  return response
}

export const config = {
  matcher: [
    // Everything except API routes, build assets, the static PWA/metadata files,
    // the /writing feeds and generated social images (no HTML, so no CSP needed).
    "/((?!api/|_next/static/|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|icons/|sw\\.js|offline\\.html|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|feed\\.xml|writing/feed\\.xml|writing/atom\\.xml|.*opengraph-image|.*twitter-image).*)",
  ],
}
