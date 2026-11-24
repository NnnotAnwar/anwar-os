import "server-only"
import { and, eq, gte, sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { assistantUsage, type AssistantUsageKind } from "@/db/schema"
import { costMicroUsd, tokenCounts } from "@/lib/claude-pricing"

// The token log: one row per Claude API response (chat turns and receipt
// photos), written as the viewer (RLS: own rows). Feeds the monthly line in
// Settings and the optional ASSISTANT_MONTHLY_LIMIT_USD stop.

type SdkUsage = Parameters<typeof tokenCounts>[0]

export async function recordUsage(entry: { kind: AssistantUsageKind; model: string; usage: SdkUsage; conversationId?: string | null }) {
  const counts = tokenCounts(entry.usage)
  try {
    await asViewer((tx) =>
      tx.insert(assistantUsage).values({
        kind: entry.kind,
        model: entry.model,
        conversationId: entry.conversationId ?? null,
        ...counts,
        costMicroUsd: costMicroUsd(entry.model, counts),
      }),
    )
  } catch (error) {
    // Never fail a user's request over bookkeeping.
    console.error("ai usage: could not record", error)
  }
}

export type MonthlyUsage = {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costMicroUsd: number
}

/** The viewer's usage since the first of this month (UTC midnight of the month's first day in `timezone`). */
export async function monthlyUsage(timezone: string): Promise<MonthlyUsage> {
  const [row] = await asViewer((tx) =>
    tx
      .select({
        requests: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${assistantUsage.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${assistantUsage.outputTokens}), 0)::bigint`,
        cacheReadTokens: sql<number>`coalesce(sum(${assistantUsage.cacheReadTokens}), 0)::bigint`,
        cacheWriteTokens: sql<number>`coalesce(sum(${assistantUsage.cacheWriteTokens}), 0)::bigint`,
        costMicroUsd: sql<number>`coalesce(sum(${assistantUsage.costMicroUsd}), 0)::bigint`,
      })
      .from(assistantUsage)
      .where(
        and(
          eq(assistantUsage.ownerId, sql`app.current_user_id()`),
          gte(assistantUsage.createdAt, sql`(date_trunc('month', now() at time zone ${timezone}) at time zone ${timezone})`),
        ),
      ),
  )
  return {
    requests: Number(row?.requests ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    cacheReadTokens: Number(row?.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row?.cacheWriteTokens ?? 0),
    costMicroUsd: Number(row?.costMicroUsd ?? 0),
  }
}
