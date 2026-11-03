import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { connection } from "next/server"
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env"
import type { Database } from "@/core/db.types"

/**
 * Request-scoped client for Server Components, Server Actions and Route Handlers.
 * Runs as the signed-in user, so RLS always applies. Create one per request.
 */
export async function createClient() {
  // Supabase reads Date.now() to check token expiry; mark this as request-time
  // work so Cache Components never tries to prerender it.
  await connection()
  const cookieStore = await cookies()

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component, which can't write cookies.
          // The proxy refreshes the session on every request, so this is safe.
        }
      },
    },
  })
}
