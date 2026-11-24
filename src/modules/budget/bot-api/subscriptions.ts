import "server-only"
import { actions } from "../actions"
import { describeRule } from "../lib/recurring"
import type { RecurringCost } from "../schema"
import { budgetBotRoute } from "./api"

// GET /api/internal/budget-bot/subscriptions: the expense bot's /subscriptions
// card. Budget's own `subscriptions` action, as the site owner (RLS). Amounts
// are positive minor units (money out), like the rest of this API.

export type BotSubscription = {
  id: string
  title: string
  amountMinor: number
  currency: string
  /** "Every month", "Every 2 weeks". */
  cadence: string
  /** The next charge on or after today; null when paused or finished. */
  nextCharge: string | null
  monthlyMinor: number
  yearlyMinor: number
  subscription: boolean
  active: boolean
  categoryName: string | null
}

export type BotSubscriptions = {
  today: string
  currency: string
  items: BotSubscription[]
  subscriptions: RecurringCost[]
  allRecurring: RecurringCost[]
  url: string
}

export async function subscriptions(): Promise<BotSubscriptions> {
  const data = await actions.subscriptions.handler({})
  return {
    today: data.today,
    currency: data.baseCurrency,
    items: data.items.map((i) => ({
      id: i.id,
      title: i.note,
      amountMinor: Math.abs(i.amountMinor),
      currency: i.currency,
      cadence: describeRule(i),
      nextCharge: i.nextCharge,
      monthlyMinor: i.monthlyMinor,
      yearlyMinor: i.yearlyMinor,
      subscription: i.subscription,
      active: i.active,
      categoryName: i.categoryName,
    })),
    subscriptions: data.subscriptions,
    allRecurring: data.allRecurring,
    url: `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/app/budget/subscriptions`,
  }
}

/** GET subscriptions: every recurring expense with next charge and cost, and the totals. */
export const subscriptionsGET = budgetBotRoute(async () => subscriptions())
