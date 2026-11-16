import "server-only"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { account } from "@/db/schema"
import { auth, googleSignInEnabled } from "@/lib/auth"
import { FRESH_AGE_SECONDS } from "@/lib/auth-config"

export type PasskeyItem = { id: string; name: string; createdAt: string; synced: boolean }

export type SignInMethods = {
  email: string
  /** Signed in recently enough to add or change a sign-in method. */
  fresh: boolean
  /** Identifies the current session, so client state resets after signing in again. */
  sessionKey: string
  hasPassword: boolean
  google: { available: boolean; connected: boolean; email: string | null }
  passkeys: PasskeyItem[]
  twoFactorEnabled: boolean
}

/** The email inside a stored Google ID token (read for display only). */
function emailFromIdToken(idToken: string | null) {
  const payload = idToken?.split(".")[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown }
    return typeof claims.email === "string" ? claims.email : null
  } catch {
    return null
  }
}

/** Everything the "Sign-in methods" card shows. Reads request headers. */
export async function getSignInMethods(): Promise<SignInMethods> {
  const requestHeaders = await headers()
  const current = await auth.api.getSession({ headers: requestHeaders })
  if (!current) redirect("/login?next=/app/settings")
  const { user, session } = current

  const [accounts, passkeys] = await Promise.all([
    auth.api.listUserAccounts({ headers: requestHeaders }),
    auth.api.listPasskeys({ headers: requestHeaders }),
  ])
  const googleAccount = accounts.find((a) => a.providerId === "google")
  let googleEmail: string | null = null
  if (googleAccount) {
    const [row] = await db
      .select({ idToken: account.idToken })
      .from(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, "google")))
      .limit(1)
    googleEmail = emailFromIdToken(row?.idToken ?? null)
  }

  return {
    email: user.email,
    fresh: Date.now() - new Date(session.createdAt).getTime() < FRESH_AGE_SECONDS * 1000,
    sessionKey: session.id,
    hasPassword: accounts.some((a) => a.providerId === "credential"),
    google: { available: googleSignInEnabled, connected: Boolean(googleAccount), email: googleEmail },
    passkeys: passkeys
      .map((p) => ({
        id: p.id,
        name: p.name || "Passkey",
        createdAt: new Date(p.createdAt).toISOString(),
        synced: Boolean(p.backedUp),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  }
}
