import "server-only"
import { and, eq, inArray, lt, sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { osbotDeliveries, type OsbotDeliveryKind } from "@/db/schema"

// What osbot's scheduled digests have already sent (osbot_deliveries), so a
// payment reminder or the weekly review goes out once even when the bot
// restarts between sending and its next poll. Runs as the owner (RLS).

const RETENTION_DAYS = 60

/** The keys among `keys` already sent for `kind`. */
export async function deliveredKeys(kind: OsbotDeliveryKind, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set()
  const rows = await asViewer((tx) =>
    tx
      .select({ key: osbotDeliveries.key })
      .from(osbotDeliveries)
      .where(and(eq(osbotDeliveries.kind, kind), inArray(osbotDeliveries.key, [...new Set(keys)]))),
  )
  return new Set(rows.map((r) => r.key))
}

/** Records `keys` as sent; repeats are no-ops. Returns how many were new. Prunes old rows. */
export async function recordDeliveries(kind: OsbotDeliveryKind, keys: string[]): Promise<number> {
  const unique = [...new Set(keys)]
  if (!unique.length) return 0
  return asViewer(async (tx) => {
    const inserted = await tx
      .insert(osbotDeliveries)
      .values(unique.map((key) => ({ kind, key })))
      .onConflictDoNothing({ target: [osbotDeliveries.ownerId, osbotDeliveries.kind, osbotDeliveries.key] })
      .returning({ id: osbotDeliveries.id })
    await tx
      .delete(osbotDeliveries)
      .where(lt(osbotDeliveries.deliveredAt, sql`now() - make_interval(days => ${RETENTION_DAYS})`))
    return inserted.length
  })
}
