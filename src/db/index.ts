import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { sql } from "drizzle-orm"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

const url = process.env.DATABASE_URL
if (!url) throw new Error("Missing env var DATABASE_URL. See .env.example.")

// One pool per process. In dev, hot reloads re-evaluate this module, so the pool
// is parked on globalThis instead of leaking a new one per edit.
const globalForDb = globalThis as unknown as { __pg?: ReturnType<typeof postgres> }
const client = globalForDb.__pg ?? postgres(url, { max: 10, idle_timeout: 30 })
if (process.env.NODE_ENV !== "production") globalForDb.__pg = client

/**
 * Connected as os_app: no superuser, no BYPASSRLS. Queries on module tables see
 * nothing unless they run inside withViewer().
 */
export const db: Db = drizzle(client, { schema })

/**
 * Runs `fn` in a transaction where RLS sees `viewerId` as the current user.
 * set_config(..., true) is transaction-local, so a pooled connection never
 * carries one viewer's identity into another request.
 */
export async function withViewer<T>(viewerId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const token = apiTokenContext.getStore()
  return db.transaction(async (tx) => {
    await tx.execute(
      token
        ? sql`select set_config('app.user_id', ${viewerId}, true), set_config('app.api_token_id', ${token.id}, true),
            set_config('transaction_read_only', ${token.write ? "off" : "on"}, true)`
        : sql`select set_config('app.user_id', ${viewerId}, true)`,
    )
    return fn(tx)
  })
}

/** The personal API token a request authenticated with (src/core/api-tokens). */
export type ApiTokenContext = { id: string; write: boolean }

const apiTokenContext = new AsyncLocalStorage<ApiTokenContext>()

/**
 * Runs `fn` on behalf of a personal API token. Every withViewer() inside it
 * also sets `app.api_token_id` (the token tables' policies refuse all access
 * then: a token can't manage tokens) and, for a token without the write
 * scope, makes the transaction read-only, so Postgres itself refuses any write.
 */
export function withApiToken<T>(token: ApiTokenContext, fn: () => Promise<T>): Promise<T> {
  return apiTokenContext.run(token, fn)
}

/** The API token of the current request, or null for a signed-in session. */
export function currentApiToken(): ApiTokenContext | null {
  return apiTokenContext.getStore() ?? null
}

/**
 * Database work for visitors with no session (public pages). No viewer is set,
 * so only policies written for public rows (e.g. `is_public and owner_id =
 * app.site_owner_id()`) let anything through.
 */
export async function asPublic<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', '', true)`)
    return fn(tx)
  })
}
