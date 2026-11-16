import "server-only"
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
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${viewerId}, true)`)
    return fn(tx)
  })
}
