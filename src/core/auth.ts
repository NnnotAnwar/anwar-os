import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { cache } from "react"
import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { db, withViewer, type Tx } from "@/db"
import { appRoles, user as users, type AppRole } from "@/db/schema"
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

// Set only by actAs(): server-to-server callers that authenticated some other
// way (e.g. the HMAC-signed osbot API) and act for one known user.
const actingAs = new AsyncLocalStorage<Viewer>()

const sessionViewer = cache(async (): Promise<Viewer | null> => {
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

/**
 * Data Access Layer: the one place that turns the session cookie into a user.
 * Better Auth validates the session against the database on every call (cached
 * per request). RLS remains the real guard; this is for routing and UI.
 * Reads request headers, so callers must render inside <Suspense>.
 * Inside actAs() it returns that user instead and never touches the request.
 */
export async function getViewer(): Promise<Viewer | null> {
  return actingAs.getStore() ?? sessionViewer()
}

/** Like getViewer, but sends signed-out visitors to /login. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer()
  if (!viewer) redirect("/login")
  return viewer
}

/** Loads a user as a Viewer, for actAs(). Null if there is no such user. */
export async function loadViewer(userId: string): Promise<Viewer | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId))
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    role: asRole(row.role),
    displayName: row.name || null,
    isAnonymous: false,
    twoFactorEnabled: Boolean(row.twoFactorEnabled),
    timezone: row.timezone ?? "Europe/Prague",
    locale: row.locale ?? "en",
  }
}

/**
 * Runs `fn` as `viewer`: getViewer(), requireViewer() and asViewer() inside it
 * (so every module action, runModuleAction() included) see that user instead
 * of the session cookie. Only for trusted server-side entry points that have
 * already authenticated the caller another way; RLS still scopes every query.
 */
export function actAs<T>(viewer: Viewer, fn: () => Promise<T>): Promise<T> {
  if (!viewer?.id) throw new Error("actAs needs a viewer")
  return actingAs.run(viewer, fn)
}

/** Runs database work as the signed-in viewer, so RLS scopes every query to them. */
export async function asViewer<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const viewer = await requireViewer()
  return withViewer(viewer.id, fn)
}
