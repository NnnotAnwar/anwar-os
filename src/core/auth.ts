import "server-only"
import { cache } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { withViewer, type Tx } from "@/db"
import { appRoles, type AppRole } from "@/db/schema"
import { auth } from "@/lib/auth"
import type { ViewerContext } from "@/core/module"

export type Viewer = ViewerContext & {
  id: string
  email: string | null
  role: AppRole
  displayName: string | null
  isAnonymous: boolean
  twoFactorEnabled: boolean
}

function asRole(value: unknown): AppRole {
  return appRoles.includes(value as AppRole) ? (value as AppRole) : "user"
}

/**
 * Data Access Layer: the one place that turns the session cookie into a user.
 * Better Auth validates the session against the database on every call (cached
 * per request). RLS remains the real guard; this is for routing and UI.
 * Reads request headers, so callers must render inside <Suspense>.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const result = await auth.api.getSession({ headers: await headers() })
  if (!result) return null
  const { user } = result

  return {
    id: user.id,
    email: user.email,
    role: asRole(user.role),
    displayName: user.name || null,
    isAnonymous: false,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    timezone: user.timezone ?? "Europe/Prague",
    locale: user.locale ?? "en",
  }
})

/** Like getViewer, but sends signed-out visitors to /login. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer()
  if (!viewer) redirect("/login")
  return viewer
}

/** Runs database work as the signed-in viewer, so RLS scopes every query to them. */
export async function asViewer<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const viewer = await requireViewer()
  return withViewer(viewer.id, fn)
}
