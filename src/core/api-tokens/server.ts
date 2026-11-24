import "server-only"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { headers } from "next/headers"
import { z } from "zod"
import { requireViewer } from "@/core/auth"
import { currentApiToken, db, withViewer } from "@/db"
import { coreApiTokens } from "@/db/schema"
import { auth } from "@/lib/auth"
import { FRESH_AGE_SECONDS } from "@/lib/auth-config"
import { expiryDate, tokenExpiryOptions } from "./options"
import { generateToken, hashToken, scopesFor, tokenPrefix, type ApiTokenScope } from "./token"

// Managing personal API tokens (Settings → API tokens) and looking one up for
// a Bearer request. Management needs a real signed-in session: inside a
// token-authenticated request every function here refuses (and so do the
// table's policies, see db/modules/core-api-tokens.sql).

export type ApiTokenItem = {
  id: string
  name: string
  prefix: string
  scopes: ApiTokenScope[]
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  expired: boolean
}

/** At most this many live tokens per user: more is a sign something leaks them. */
export const MAX_ACTIVE_TOKENS = 20

export class ApiTokenError extends Error {}

/** Throws inside a request authenticated by an API token. */
export function assertSessionRequest() {
  if (currentApiToken()) throw new ApiTokenError("API tokens can't manage API tokens.")
}

async function sessionViewer() {
  assertSessionRequest()
  const viewer = await requireViewer()
  if (viewer.role === "demo" || viewer.isAnonymous) throw new ApiTokenError("Demo accounts can't create API tokens.")
  return viewer
}

/**
 * Minting a credential is like adding a passkey: only within an hour of
 * signing in (Settings offers "Confirm it's you" otherwise). Reads the session.
 */
export async function isSessionFresh(now = Date.now()): Promise<boolean> {
  if (currentApiToken()) return false
  const current = await auth.api.getSession({ headers: await headers() })
  if (!current) return false
  return now - new Date(current.session.createdAt).getTime() < FRESH_AGE_SECONDS * 1000
}

const columns = {
  id: coreApiTokens.id,
  name: coreApiTokens.name,
  prefix: coreApiTokens.prefix,
  scopes: coreApiTokens.scopes,
  createdAt: coreApiTokens.createdAt,
  expiresAt: coreApiTokens.expiresAt,
  lastUsedAt: coreApiTokens.lastUsedAt,
}

/** The viewer's tokens that aren't revoked, newest first (expired ones included, marked). */
export async function listApiTokens(now = new Date()): Promise<ApiTokenItem[]> {
  const viewer = await sessionViewer()
  const rows = await withViewer(viewer.id, (tx) =>
    tx
      .select(columns)
      .from(coreApiTokens)
      .where(and(eq(coreApiTokens.ownerId, viewer.id), isNull(coreApiTokens.revokedAt)))
      .orderBy(desc(coreApiTokens.createdAt)),
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expired: r.expiresAt !== null && r.expiresAt <= now,
  }))
}

export const createTokenInput = z.object({
  name: z.string().trim().min(1, "Give the token a name.").max(60, "Keep the name under 60 characters."),
  write: z.boolean().default(false),
  expiry: z.enum(tokenExpiryOptions.map((o) => o.id) as [string, ...string[]]).default("90"),
})

/** Creates a token and returns it in clear, the only time it is ever available. */
export async function createApiToken(input: z.input<typeof createTokenInput>) {
  const viewer = await sessionViewer()
  const { name, write, expiry } = createTokenInput.parse(input)
  const token = generateToken()
  const expiresAt = expiryDate(expiry)
  const id = await withViewer(viewer.id, async (tx) => {
    const [{ active }] = (await tx
      .select({ active: sql<number>`count(*)::int` })
      .from(coreApiTokens)
      .where(and(eq(coreApiTokens.ownerId, viewer.id), isNull(coreApiTokens.revokedAt)))) as [{ active: number }]
    if (active >= MAX_ACTIVE_TOKENS) throw new ApiTokenError(`You have ${active} tokens. Revoke one you no longer use first.`)
    // Raw SQL on purpose: os_app may insert only these columns (column grants),
    // and drizzle's insert names every column of the table.
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into core_api_tokens (name, prefix, token_hash, scopes, expires_at)
      values (${name}, ${tokenPrefix(token)}, ${hashToken(token)}, ${`{${scopesFor(write).join(",")}}`}::text[],
              ${expiresAt?.toISOString() ?? null}::timestamptz)
      returning id`)
    return row!.id
  })
  return { id, token, name, prefix: tokenPrefix(token), scopes: scopesFor(write), expiresAt: expiresAt?.toISOString() ?? null }
}

/** Revokes one of the viewer's tokens. Idempotent; false when there is no such live token. */
export async function revokeApiToken(id: string): Promise<boolean> {
  const viewer = await sessionViewer()
  const tokenId = z.uuid().parse(id)
  const rows = await withViewer(viewer.id, (tx) =>
    tx
      .update(coreApiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(coreApiTokens.id, tokenId), eq(coreApiTokens.ownerId, viewer.id), isNull(coreApiTokens.revokedAt)))
      .returning({ id: coreApiTokens.id }),
  )
  return rows.length > 0
}

export type AuthenticatedToken = { id: string; userId: string; scopes: ApiTokenScope[]; expiresAt: Date | null }

/**
 * Looks a Bearer token up through app.authenticate_api_token() (security
 * definer: there is no viewer yet). Null for unknown, revoked or expired
 * tokens, without saying which.
 */
export async function authenticateToken(token: string): Promise<AuthenticatedToken | null> {
  const rows = await db.execute<{ token_id: string; user_id: string; scopes: ApiTokenScope[]; expires_at: string | Date | null }>(
    sql`select token_id, user_id, scopes, expires_at from app.authenticate_api_token(${tokenPrefix(token)}, ${hashToken(token)})`,
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.token_id,
    userId: row.user_id,
    scopes: row.scopes,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
  }
}
