import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { AppRole, ViewerContext } from "@/core/module"

export type Viewer = ViewerContext & {
  id: string
  email: string | null
  role: AppRole
  displayName: string | null
  isAnonymous: boolean
}

/**
 * Data Access Layer: the one place that turns the session cookie into a user.
 * Verifies the JWT (getClaims) and loads the role from `profiles`. RLS remains the
 * real guard; this is for routing and UI. Returns null when signed out.
 * Reads cookies, so callers must render inside <Suspense>.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, timezone, locale")
    .eq("id", claims.sub)
    .single()
  if (!profile) return null

  return {
    id: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    role: profile.role,
    displayName: profile.display_name,
    isAnonymous: Boolean(claims.is_anonymous),
    timezone: profile.timezone,
    locale: profile.locale,
  }
})

/** Like getViewer, but sends signed-out visitors to /login. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer()
  if (!viewer) redirect("/login")
  return viewer
}
