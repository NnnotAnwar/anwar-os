import "server-only"
import { inArray } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { hasModule, runModuleAction } from "@/core/module-actions"
import { budgetLimits } from "@/db/schema"
import { limitAlertKey, reachedThresholds, type LimitThreshold } from "@/modules/budget/lib/limits"
import type { LimitsData } from "@/modules/budget/schema"
import { osbotRoute, parseInput } from "./api"
import { deliveredKeys, recordDeliveries } from "./deliveries"

// Budget limit alerts: osbot asks once a minute (budget-limits/due) for the
// categories that reached 90 % or 100 % of their monthly limit this month and
// weren't announced yet, sends one message each and acks the keys
// (budget-limits/ack). osbot_deliveries remembers what went out, so a restart
// or the next poll never repeats it. One expense that jumps from 50 % to 120 %
// announces only "used up"; its 90 % key is acked with it, so 90 % never
// follows. Reads go through Budget's own `limits` action; runs inside
// actAs(owner) like every osbot endpoint (api.ts), so RLS applies.

export type LimitAlert = {
  /** `<category id>:<YYYY-MM>:<90|100>`, what budget-limits/ack takes. */
  key: string
  /** Every key this alert settles: the 90 % one too when 100 % came first. */
  keys: string[]
  categoryId: string
  name: string
  threshold: LimitThreshold
  limitMinor: number
  spentMinor: number
  leftMinor: number
  percent: number
  /** Month-end total at the current pace (null early in the month). */
  paceMinor: number | null
  currency: string
  month: string
}

export type LimitAlertsDue = { month: string; items: LimitAlert[]; url: string }

const url = () => `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/app/budget/limits`

/** Categories that crossed a threshold this month and haven't been announced (the highest new threshold only). */
export async function limitAlertsDue(): Promise<LimitAlertsDue> {
  if (!(await hasModule("budget"))) return { month: "", items: [], url: url() }
  const data = await runModuleAction<LimitsData>("budget", "limits", {})
  const reached = data.items.map((item) => ({
    item,
    keys: reachedThresholds(item.spentMinor, item.limitMinor).map((pct) => ({ pct, key: limitAlertKey(item.categoryId, data.month, pct) })),
  }))
  const sent = await deliveredKeys(
    "budget-limit",
    reached.flatMap((r) => r.keys.map((k) => k.key)),
  )
  const items: LimitAlert[] = []
  for (const { item, keys } of reached) {
    const fresh = keys.filter((k) => !sent.has(k.key))
    const top = fresh.at(-1)
    if (!top) continue
    items.push({
      key: top.key,
      keys: fresh.map((k) => k.key),
      categoryId: item.categoryId,
      name: item.name,
      threshold: top.pct,
      limitMinor: item.limitMinor,
      spentMinor: item.spentMinor,
      leftMinor: item.leftMinor,
      percent: item.percent,
      paceMinor: item.paceMinor,
      currency: data.baseCurrency,
      month: data.month,
    })
  }
  return { month: data.month, items, url: url() }
}

const LIMIT_KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{4}-(0[1-9]|1[0-2])):(90|100)$/

export const ackLimitAlertsInput = z.object({
  keys: z.array(z.string().regex(LIMIT_KEY, "Expected <category id>:<YYYY-MM>:<90|100>.")).min(1).max(200),
})

/** Records alerts as sent. Keys for categories without the owner's limit are skipped; repeats are no-ops. */
export async function ackLimitAlerts({ keys }: z.infer<typeof ackLimitAlertsInput>): Promise<{ acked: number }> {
  const ids = [...new Set(keys.map((k) => LIMIT_KEY.exec(k)![1]!))]
  const visible = await asViewer((tx) =>
    tx.select({ id: budgetLimits.categoryId }).from(budgetLimits).where(inArray(budgetLimits.categoryId, ids)),
  )
  const mine = new Set(visible.map((v) => v.id))
  const acked = await recordDeliveries("budget-limit", keys.filter((k) => mine.has(LIMIT_KEY.exec(k)![1]!)))
  return { acked }
}

/** GET budget-limits/due: categories past 90 % / 100 % of their monthly limit, not yet announced. */
export const limitAlertsDueGET = osbotRoute(async () => limitAlertsDue())

/** POST budget-limits/ack { keys: ["<category id>:<YYYY-MM>:<90|100>"] } once the message is sent. */
export const limitAlertsAckPOST = osbotRoute(async ({ body }) => ackLimitAlerts(parseInput(ackLimitAlertsInput, body)))
