import { z } from "zod"
import { MAX_IMPORT_ROWS } from "./lib/csv"
import { categoryColorNames } from "./lib/colors"
import { parseIsoDate } from "./lib/dates"

// Client-safe mirrors of the enums in src/db/schema/budget.ts (client
// components never import Drizzle); schema.test.ts keeps them equal.
export const accountKinds = ["cash", "bank", "savings", "investment"] as const
export type AccountKind = (typeof accountKinds)[number]
export const categoryKinds = ["income", "expense"] as const
export type CategoryKind = (typeof categoryKinds)[number]
export const recurringFreqs = ["weekly", "monthly", "yearly"] as const
export type RecurringFreq = (typeof recurringFreqs)[number]

export const accountKindLabels: Record<AccountKind, string> = {
  cash: "Cash",
  bank: "Bank",
  savings: "Savings",
  investment: "Investment",
}

// ---------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .refine((v) => parseIsoDate(v) !== null, "Use a real date.")
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. CZK.")
const minor = z.number().int().safe()
const signedAmount = minor.refine((v) => v !== 0, "The amount can't be zero.").refine((v) => Math.abs(v) < 1e14, "That amount is too large.")
const tags = z.array(z.string().trim().min(1).max(40)).max(20, "Up to 20 tags.")
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.")

export const idInput = z.object({ id: z.uuid() })
export const idsInput = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_IMPORT_ROWS) })

// Transactions ---------------------------------------------------------------

export const transactionFields = z.object({
  accountId: z.uuid("Choose an account."),
  categoryId: z.uuid().nullable().default(null),
  amountMinor: signedAmount,
  occurredOn: isoDate,
  note: z.string().trim().max(500, "Keep the note under 500 characters.").default(""),
  tags: tags.default([]),
})
export const createTransactionInput = transactionFields
export const updateTransactionInput = transactionFields.extend({ id: z.uuid() })
export const quickAddInput = z.object({
  text: z.string().trim().min(1, "Type an amount, e.g. “250 food lunch”.").max(300),
  accountId: z.uuid().nullable().default(null),
})
export const transferInput = z.object({
  fromAccountId: z.uuid("Choose the account the money leaves."),
  toAccountId: z.uuid("Choose the account the money goes to."),
  amountMinor: minor.positive("Enter an amount above zero."),
  occurredOn: isoDate,
  note: z.string().trim().max(500).default(""),
})
export const listTransactionsInput = z.object({
  month: month.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  /** "none" lists uncategorised transactions. */
  uncategorized: z.boolean().optional(),
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(2000).default(500),
})
export const monthInput = z.object({ month: month.optional() })

// Accounts -------------------------------------------------------------------

export const accountFields = z.object({
  name: z.string().trim().min(1, "Name the account.").max(80, "Keep the name under 80 characters."),
  kind: z.enum(accountKinds).default("bank"),
  currency: currency.default("CZK"),
  openingBalanceMinor: minor.default(0),
  openedOn: isoDate.optional(),
})
export const createAccountInput = accountFields
export const updateAccountInput = accountFields.extend({ id: z.uuid() })
export const archiveInput = z.object({ id: z.uuid(), archived: z.boolean() })

// Categories -----------------------------------------------------------------

export const categoryFields = z.object({
  name: z.string().trim().min(1, "Name the category.").max(60, "Keep the name under 60 characters."),
  kind: z.enum(categoryKinds).default("expense"),
  parentId: z.uuid().nullable().default(null),
  color: z.enum(categoryColorNames as [string, ...string[]]).default("accent-500"),
})
export const createCategoryInput = categoryFields
export const updateCategoryInput = categoryFields.extend({ id: z.uuid() })

// Recurring ------------------------------------------------------------------

const recurringBase = z.object({
  accountId: z.uuid("Choose an account."),
  categoryId: z.uuid().nullable().default(null),
  amountMinor: signedAmount,
  note: z.string().trim().min(1, "Describe it, e.g. Rent.").max(200),
  tags: tags.default([]),
  freq: z.enum(recurringFreqs).default("monthly"),
  interval: z.number().int().min(1).max(52).default(1),
  startOn: isoDate,
  endOn: isoDate.nullable().default(null),
})
const endsAfterStart = (v: { startOn: string; endOn: string | null }) => !v.endOn || v.endOn >= v.startOn
const endMessage = { message: "The end can't be before the start.", path: ["endOn"] }
// subscription: listed and totalled under Subscriptions (money out only).
// Left out of an update, it stays as it was.
export const createRecurringInput = recurringBase
  .extend({ subscription: z.boolean().default(false) })
  .refine(endsAfterStart, endMessage)
export const updateRecurringInput = recurringBase
  .extend({ id: z.uuid(), subscription: z.boolean().optional() })
  .refine(endsAfterStart, endMessage)
export const setActiveInput = z.object({ id: z.uuid(), active: z.boolean() })
export const setSubscriptionInput = z.object({ id: z.uuid(), subscription: z.boolean() })
/** Recurring charges between two dates (default: the next 7 days from the viewer's today). */
export const upcomingPaymentsInput = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    days: z.number().int().min(1).max(62).default(7),
    subscriptionsOnly: z.boolean().default(false),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { message: "The end can't be before the start.", path: ["to"] })

// Goals ----------------------------------------------------------------------

export const goalFields = z.object({
  name: z.string().trim().min(1, "Name the goal.").max(80),
  targetMinor: minor.positive("Set a target above zero."),
  currency: currency.default("CZK"),
  deadline: isoDate.nullable().default(null),
  accountId: z.uuid().nullable().default(null),
  savedMinor: minor.nonnegative().default(0),
})
export const createGoalInput = goalFields
export const updateGoalInput = goalFields.extend({ id: z.uuid() })

// Plan -----------------------------------------------------------------------

export const planInput = z.object({
  startingCapitalMinor: minor.nonnegative("Starting capital can't be negative.").max(1e14),
  monthlyContributionMinor: minor.nonnegative("The monthly amount can't be negative.").max(1e12),
  annualReturnBp: z.number().int().min(-5000, "Use −50 % to 100 %.").max(10000, "Use −50 % to 100 %."),
  horizonYears: z.number().int().min(1, "Plan at least one year.").max(60, "Plan up to 60 years."),
  startMonth: month,
  currency: currency.default("CZK"),
})

// Import ---------------------------------------------------------------------

export const importInput = z.object({
  accountId: z.uuid("Choose the account to import into."),
  rows: z
    .array(
      z.object({
        occurredOn: isoDate,
        amountMinor: signedAmount,
        note: z.string().max(500).default(""),
        categoryName: z.string().max(60).nullable().default(null),
        /**
         * Stable id of the row in its source, e.g. "bot-expenses:42". A row whose
         * key was imported before is skipped, whatever it looks like now; rows
         * without a key are matched by date, amount and note instead.
         */
        importKey: z.string().trim().min(1).max(200).optional(),
        /** When the source recorded it; kept as the transaction's created_at (the time of day). */
        recordedAt: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .min(1, "Nothing to import.")
    .max(MAX_IMPORT_ROWS, `Import up to ${MAX_IMPORT_ROWS} rows at a time.`),
})
export const existingKeysInput = z.object({ accountId: z.uuid(), from: isoDate, to: isoDate })

// ---------------------------------------------------------------------------
// Shapes returned to pages
// ---------------------------------------------------------------------------

export type Account = {
  id: string
  name: string
  kind: AccountKind
  currency: string
  openingBalanceMinor: number
  openedOn: string
  archived: boolean
  balanceMinor: number
  transactionCount: number
}

export type Category = {
  id: string
  name: string
  kind: CategoryKind
  parentId: string | null
  color: string
  archived: boolean
  transactionCount: number
}

export type Transaction = {
  id: string
  accountId: string
  accountName: string
  currency: string
  categoryId: string | null
  categoryName: string | null
  categoryColor: string | null
  amountMinor: number
  occurredOn: string
  note: string
  tags: string[]
  recurringId: string | null
  transferId: string | null
}

export type Recurring = {
  id: string
  accountId: string
  accountName: string
  currency: string
  categoryId: string | null
  categoryName: string | null
  amountMinor: number
  note: string
  tags: string[]
  freq: RecurringFreq
  interval: number
  startOn: string
  nextDue: string
  endOn: string | null
  active: boolean
  subscription: boolean
}

/** A recurring expense on the Subscriptions screen. */
export type SubscriptionItem = Recurring & {
  /** The next charge on or after today, or null when paused or finished. */
  nextCharge: string | null
  /** What it costs a month / a year, positive minor units (money out). */
  monthlyMinor: number
  yearlyMinor: number
}

/** What active recurring expenses cost, per currency, positive minor units. */
export type RecurringCost = { currency: string; monthlyMinor: number; yearlyMinor: number; count: number }

export type SubscriptionsData = {
  today: string
  baseCurrency: string
  /** Every recurring expense: active first, by next charge. */
  items: SubscriptionItem[]
  /** Active subscriptions, base currency first. */
  subscriptions: RecurringCost[]
  /** Every active recurring expense (subscriptions included), base currency first. */
  allRecurring: RecurringCost[]
}

/** One expected charge of a recurring expense. amountMinor is positive (money out). */
export type UpcomingPayment = {
  recurringId: string
  note: string
  amountMinor: number
  currency: string
  date: string
  subscription: boolean
  categoryName: string | null
  accountName: string
}

export type Goal = {
  id: string
  name: string
  targetMinor: number
  currency: string
  deadline: string | null
  accountId: string | null
  accountName: string | null
  savedMinor: number
  /** Linked account balance, or savedMinor. */
  progressMinor: number
}

export type PlanRow = {
  startingCapitalMinor: number
  monthlyContributionMinor: number
  annualReturnBp: number
  horizonYears: number
  startOn: string
  currency: string
}

export type CategoryTotal = { id: string | null; name: string; color: string | null; amountMinor: number }

export type Overview = {
  month: string
  today: string
  baseCurrency: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
  savingsRate: number | null
  spending: CategoryTotal[]
  /** Income and spending in other currencies, not converted. */
  otherCurrencies: { currency: string; incomeMinor: number; expenseMinor: number }[]
  accounts: Account[]
  transactionCount: number
}

export class BudgetInputError extends Error {}
