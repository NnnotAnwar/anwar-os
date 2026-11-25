import "server-only"
import { eq } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { budgetCategories as c } from "@/db/schema"
import { actions } from "../actions"
import { monthOf } from "../lib/dates"
import type { CategoryLimit } from "../schema"
import { budgetBotRoute } from "./api"

// The expense bot and Budget's monthly category limits: the "Food: 800 of
// 6 000 left" line under a saved expense, and the /limits card. Budget's own
// `limits` action, as the site owner (RLS). Amounts are minor units in the base
// currency; spent and limit are positive, left goes negative once over.

export type BotLimit = Pick<CategoryLimit, "categoryId" | "name" | "limitMinor" | "spentMinor" | "leftMinor" | "percent" | "status" | "paceMinor"> & {
  currency: string
  month: string
}

const appUrl = (path: string) => `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}${path}`

const toBot = (item: CategoryLimit, currency: string, month: string): BotLimit => ({
  categoryId: item.categoryId,
  name: item.name,
  limitMinor: item.limitMinor,
  spentMinor: item.spentMinor,
  leftMinor: item.leftMinor,
  percent: item.percent,
  status: item.status,
  paceMinor: item.paceMinor,
  currency,
  month,
})

/**
 * The limit an expense counts against, as it stands after the expense: its
 * category's, or its parent's for a subcategory, in the expense's month. Null
 * without a category or a limit, or when the expense is in a currency that
 * has no ČNB rate (so the limit doesn't count it). Other currencies count at
 * the rate of their day.
 */
export async function limitForExpense(expense: { categoryId: string | null; currency: string; occurredOn: string }): Promise<BotLimit | null> {
  if (!expense.categoryId) return null
  const [cat] = await asViewer((tx) => tx.select({ parentId: c.parentId }).from(c).where(eq(c.id, expense.categoryId!)))
  if (!cat) return null
  const top = cat.parentId ?? expense.categoryId
  const month = monthOf(expense.occurredOn)
  const data = await actions.limits.handler({ month })
  if (data.fx.unavailable.includes(expense.currency)) return null
  const item = data.items.find((x) => x.categoryId === top)
  return item ? toBot(item, data.baseCurrency, month) : null
}

export type BotLimits = { month: string; today: string; currency: string; items: BotLimit[]; url: string }

/** This month's limits, the fullest first. */
export async function limits(): Promise<BotLimits> {
  const data = await actions.limits.handler({})
  return {
    month: data.month,
    today: data.today,
    currency: data.baseCurrency,
    items: data.items.map((x) => toBot(x, data.baseCurrency, data.month)),
    url: appUrl("/app/budget/limits"),
  }
}

/** GET limits: this month's category limits for the /limits card. */
export const limitsGET = budgetBotRoute(async () => limits())
