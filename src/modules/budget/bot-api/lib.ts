// Pure helpers of the expense bot's internal API (/api/internal/budget-bot/*):
// its signature headers, the expense shape it speaks, and the category order
// of its picker. No server-only imports, so they are unit-tested directly.
//
// The bot speaks in expenses: a positive amount spent. Budget stores the same
// thing as a negative transaction (money out) that isn't a transfer leg.

import { signatureHeaderNames } from "@/lib/signed-request"

/** x-budget-bot-timestamp, x-budget-bot-nonce, x-budget-bot-signature (bots/expenses/expenses_bot/signing.py). */
export const BUDGET_BOT_SIGNATURE_HEADERS = signatureHeaderNames("x-budget-bot")

/** Where the expense bot's rows come from in an import: "bot-expenses:<id in bot_expenses.expenses>". */
export const BOT_IMPORT_KEY = /^bot-expenses:\d{1,18}$/

export type BotExpense = {
  id: string
  /** Spent, in minor units: always positive. */
  amountMinor: number
  currency: string
  categoryId: string | null
  categoryName: string | null
  note: string
  /** The day it counts for (YYYY-MM-DD). */
  occurredOn: string
  /** When it was recorded (ISO instant): the bot shows its time when it is on occurredOn. */
  recordedAt: string
  accountId: string
  accountName: string
}

export type ExpenseRow = Omit<BotExpense, "amountMinor" | "recordedAt"> & { amountMinor: number; createdAt: Date | string }

export function toBotExpense(row: ExpenseRow): BotExpense {
  return {
    id: row.id,
    amountMinor: Math.abs(row.amountMinor),
    currency: row.currency,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    note: row.note,
    occurredOn: row.occurredOn,
    recordedAt: new Date(row.createdAt).toISOString(),
    accountId: row.accountId,
    accountName: row.accountName,
  }
}

export type BotCategory = {
  id: string
  name: string
  parentId: string | null
  parentName: string | null
  color: string
  /** Expenses in it over the last 90 days. */
  uses: number
}

export type CategoryUsage = { categoryId: string; uses: number; lastUsedAt: string }

/**
 * Expense categories for the bot's picker: most used in the last 90 days
 * first (ties: most recently used), then the rest by name.
 */
export function rankCategories<T extends { id: string; name: string }>(
  categories: T[],
  usage: CategoryUsage[],
): (T & { uses: number })[] {
  const by = new Map(usage.map((u) => [u.categoryId, u]))
  const last = (id: string) => by.get(id)?.lastUsedAt ?? ""
  return categories
    .map((c) => ({ ...c, uses: by.get(c.id)?.uses ?? 0 }))
    .sort((a, b) => b.uses - a.uses || last(b.id).localeCompare(last(a.id)) || a.name.localeCompare(b.name))
}

/** Totals spent per currency, e.g. { CZK: 125000 }. */
export type CurrencyTotals = Record<string, number>
