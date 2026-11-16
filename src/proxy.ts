import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

/**
 * Optimistic gate: no session cookie → /login. This only checks the cookie is
 * present; the DAL (requireViewer) validates it against the database, and RLS
 * is the last line.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.search = new URLSearchParams({ next: request.nextUrl.pathname }).toString()
  url.pathname = "/login"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/app/:path*"],
}
