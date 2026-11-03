import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env"

const CACHE_HEADERS = ["cache-control", "expires", "pragma"] as const

/**
 * Refreshes the Supabase session on every matched request and gates /app.
 * Must return the response built by `setAll`, or refreshed cookies are lost.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))
      },
    },
  })

  // Do not run code between createServerClient and getClaims().
  // getClaims() verifies the JWT signature; never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims

  const path = request.nextUrl.pathname
  const isApp = path === "/app" || path.startsWith("/app/")
  const isMfa = path.startsWith("/login/mfa")

  if ((isApp || isMfa) && !claims) {
    return redirectWithCookies(request, response, "/login", { next: path })
  }

  if (claims && (isApp || isMfa)) {
    // Users with a verified TOTP factor must complete it before reaching /app.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const needsMfa = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2"
    if (isApp && needsMfa) {
      return redirectWithCookies(request, response, "/login/mfa", { next: path })
    }
    if (isMfa && !needsMfa) {
      return redirectWithCookies(request, response, "/app")
    }
  }

  return response
}

function redirectWithCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
  params: Record<string, string> = {},
) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = new URLSearchParams(params).toString()
  const redirect = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  for (const header of CACHE_HEADERS) {
    const value = from.headers.get(header)
    if (value) redirect.headers.set(header, value)
  }
  return redirect
}
