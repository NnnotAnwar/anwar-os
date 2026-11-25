import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: budget. Money is bigint minor units (haléře, cents) + ISO 4217
// currency. RLS, triggers, grants and the composite foreign keys that need
// `on delete set null (column)` live in db/modules/budget.sql.
//
// Transactions carry a SIGNED amount: negative = money out (expense), positive
// = money in (income). A transfer between own accounts is two rows sharing a
// `transfer_id`; reports leave transfers out of income and spending.

export const budgetAccountKinds = ["cash", "bank", "savings", "investment"] as const
export type BudgetAccountKind = (typeof budgetAccountKinds)[number]
export const budgetCategoryKinds = ["income", "expense"] as const
export type BudgetCategoryKind = (typeof budgetCategoryKinds)[number]
export const budgetRecurringFreqs = ["weekly", "monthly", "yearly"] as const
export type BudgetRecurringFreq = (typeof budgetRecurringFreqs)[number]

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

const currency = () => char("currency", { length: 3 }).notNull().default("CZK")
const money = (name: string) => bigint(name, { mode: "number" })

/** One row per user: the base currency for reports, and when defaults were seeded. */
export const budgetSettings = pgTable(
  "budget_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId().unique("budget_settings_owner_key"),
    baseCurrency: char("base_currency", { length: 3 }).notNull().default("CZK"),
    seededAt: timestamp("seeded_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [check("budget_settings_currency_shape", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`)],
)

/** Balance = opening_balance_minor + every transaction on the account. */
export const budgetAccounts = pgTable(
  "budget_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    kind: text("kind", { enum: budgetAccountKinds }).notNull().default("bank"),
    currency: currency(),
    openingBalanceMinor: money("opening_balance_minor").notNull().default(0),
    /** The opening balance counts from this date in net-worth history. */
    openedOn: date("opened_on", { mode: "string" }).notNull().default(sql`current_date`),
    archived: boolean("archived").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("budget_accounts_owner_id_key").on(t.ownerId, t.id),
    // Target of the transactions/recurring FK that pins their currency to the account's.
    unique("budget_accounts_owner_id_currency_key").on(t.ownerId, t.id, t.currency),
    index("budget_accounts_owner_idx").on(t.ownerId, t.archived, t.name),
    check("budget_accounts_name_length", sql`char_length(${t.name}) between 1 and 80`),
    check("budget_accounts_kind_valid", sql`${t.kind} in ('cash', 'bank', 'savings', 'investment')`),
    check("budget_accounts_currency_shape", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
)

/** Two levels at most (the app keeps parents top-level); same kind as the parent. */
export const budgetCategories = pgTable(
  "budget_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    kind: text("kind", { enum: budgetCategoryKinds }).notNull().default("expense"),
    parentId: uuid("parent_id"),
    /** A colour token name from modules/budget/lib/colors.ts, e.g. "accent-500". */
    color: text("color").notNull().default("accent-500"),
    archived: boolean("archived").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("budget_categories_owner_id_key").on(t.ownerId, t.id),
    uniqueIndex("budget_categories_owner_name_key").on(
      t.ownerId,
      t.kind,
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    check("budget_categories_name_length", sql`char_length(${t.name}) between 1 and 60`),
    check("budget_categories_kind_valid", sql`${t.kind} in ('income', 'expense')`),
    check("budget_categories_color_shape", sql`${t.color} ~ '^[a-z0-9-]{1,32}$'`),
    check("budget_categories_not_own_parent", sql`${t.parentId} is distinct from ${t.id}`),
  ],
)

/** A template plus a simple rule; "Generate due" materialises it into transactions. */
export const budgetRecurring = pgTable(
  "budget_recurring",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id").notNull(),
    currency: currency(),
    categoryId: uuid("category_id"),
    amountMinor: money("amount_minor").notNull(),
    note: text("note").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    freq: text("freq", { enum: budgetRecurringFreqs }).notNull().default("monthly"),
    interval: integer("interval").notNull().default(1),
    /** First occurrence; later ones are computed from it (31st → last day of short months). */
    startOn: date("start_on", { mode: "string" }).notNull(),
    /** The next occurrence not yet turned into a transaction. */
    nextDue: date("next_due", { mode: "string" }).notNull(),
    endOn: date("end_on", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    /**
     * A subscription (streaming, software, a gym): listed under Budget →
     * Subscriptions with its monthly cost. Other recurring expenses (rent,
     * utilities) are shown there too, but not counted in "Subscriptions cost…".
     */
    subscription: boolean("subscription").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("budget_recurring_owner_id_key").on(t.ownerId, t.id),
    foreignKey({
      name: "budget_recurring_account_fk",
      columns: [t.ownerId, t.accountId, t.currency],
      foreignColumns: [budgetAccounts.ownerId, budgetAccounts.id, budgetAccounts.currency],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    index("budget_recurring_owner_due_idx").on(t.ownerId, t.active, t.nextDue),
    check("budget_recurring_amount_nonzero", sql`${t.amountMinor} <> 0`),
    check("budget_recurring_note_length", sql`char_length(${t.note}) <= 200`),
    check("budget_recurring_freq_valid", sql`${t.freq} in ('weekly', 'monthly', 'yearly')`),
    check("budget_recurring_interval_range", sql`${t.interval} between 1 and 52`),
    check("budget_recurring_next_after_start", sql`${t.nextDue} >= ${t.startOn}`),
    check("budget_recurring_end_after_start", sql`${t.endOn} is null or ${t.endOn} >= ${t.startOn}`),
  ],
)

export const budgetTransactions = pgTable(
  "budget_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id").notNull(),
    /** Always the account's currency (enforced by the composite FK). */
    currency: currency(),
    categoryId: uuid("category_id"),
    /** Signed: negative = out, positive = in. Never zero. */
    amountMinor: money("amount_minor").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    note: text("note").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Set when "Generate due" created the row; unique per date keeps generation idempotent. */
    recurringId: uuid("recurring_id"),
    /** Both legs of a transfer between own accounts share this id. */
    transferId: uuid("transfer_id"),
    /**
     * Stable id of the row in the source it was imported from, e.g.
     * "bot-expenses:42". Unique per owner, so re-running an import never
     * duplicates; null for everything typed in.
     */
    importKey: text("import_key"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "budget_transactions_account_fk",
      columns: [t.ownerId, t.accountId, t.currency],
      foreignColumns: [budgetAccounts.ownerId, budgetAccounts.id, budgetAccounts.currency],
    })
      .onUpdate("cascade")
      .onDelete("restrict"),
    unique("budget_transactions_recurring_date_key").on(t.recurringId, t.occurredOn),
    unique("budget_transactions_owner_import_key").on(t.ownerId, t.importKey),
    index("budget_transactions_owner_date_idx").on(t.ownerId, t.occurredOn.desc()),
    index("budget_transactions_owner_account_date_idx").on(t.ownerId, t.accountId, t.occurredOn),
    index("budget_transactions_owner_category_idx").on(t.ownerId, t.categoryId),
    index("budget_transactions_transfer_idx").on(t.transferId),
    check("budget_transactions_amount_nonzero", sql`${t.amountMinor} <> 0`),
    check("budget_transactions_note_length", sql`char_length(${t.note}) <= 500`),
    check("budget_transactions_tags_count", sql`cardinality(${t.tags}) <= 20`),
    check("budget_transactions_import_key_length", sql`char_length(${t.importKey}) between 1 and 200`),
  ],
)

/** Savings goals. Progress = the linked account's balance, or saved_minor when unlinked. */
export const budgetGoals = pgTable(
  "budget_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    targetMinor: money("target_minor").notNull(),
    currency: currency(),
    deadline: date("deadline", { mode: "string" }),
    accountId: uuid("account_id"),
    savedMinor: money("saved_minor").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("budget_goals_owner_idx").on(t.ownerId, t.archived),
    check("budget_goals_name_length", sql`char_length(${t.name}) between 1 and 80`),
    check("budget_goals_target_positive", sql`${t.targetMinor} > 0`),
    check("budget_goals_saved_nonnegative", sql`${t.savedMinor} >= 0`),
    check("budget_goals_currency_shape", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
)

/**
 * A monthly spending limit for one top-level expense category, in the base
 * currency; it applies to every calendar month and counts its subcategories.
 * Removing the category removes its limit.
 */
export const budgetLimits = pgTable(
  "budget_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    categoryId: uuid("category_id").notNull(),
    amountMinor: money("amount_minor").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("budget_limits_owner_category_key").on(t.ownerId, t.categoryId),
    foreignKey({
      name: "budget_limits_category_fk",
      columns: [t.ownerId, t.categoryId],
      foreignColumns: [budgetCategories.ownerId, budgetCategories.id],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    check("budget_limits_amount_positive", sql`${t.amountMinor} > 0 and ${t.amountMinor} < 100000000000000`),
  ],
)

/** The capital-growth plan: one per user. Return in basis points (700 = 7.00 %). */
export const budgetPlans = pgTable(
  "budget_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId().unique("budget_plans_owner_key"),
    startingCapitalMinor: money("starting_capital_minor").notNull().default(0),
    monthlyContributionMinor: money("monthly_contribution_minor").notNull().default(0),
    annualReturnBp: integer("annual_return_bp").notNull().default(700),
    horizonYears: integer("horizon_years").notNull().default(10),
    /** First day of the month the plan starts. */
    startOn: date("start_on", { mode: "string" }).notNull(),
    currency: currency(),
    ...timestamps(),
  },
  (t) => [
    check("budget_plans_starting_nonnegative", sql`${t.startingCapitalMinor} >= 0`),
    check("budget_plans_monthly_nonnegative", sql`${t.monthlyContributionMinor} >= 0`),
    check("budget_plans_return_range", sql`${t.annualReturnBp} between -5000 and 10000`),
    check("budget_plans_horizon_range", sql`${t.horizonYears} between 1 and 60`),
    check("budget_plans_start_first_of_month", sql`extract(day from ${t.startOn}) = 1`),
    check("budget_plans_currency_shape", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
)

/**
 * The Telegram expense bot's last sign of life (one row per owner). The bot has
 * no database access; it beats through /api/internal/budget-bot/heartbeat,
 * which acts as the site owner. Read by the Bots panel.
 */
export const budgetBotHeartbeats = pgTable(
  "budget_bot_heartbeats",
  {
    ownerId: ownerId().primaryKey(),
    version: text("version").notNull().default("dev"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("budget_bot_heartbeats_version_length", sql`char_length(${t.version}) between 1 and 80`)],
)

// ---------------------------------------------------------------------------
// Exchange rates (ČNB). Public data shared by every user: no owner_id. RLS on,
// everyone signed in (os_app) may read; nobody may write directly. Rows arrive
// only through app.budget_fx_save_daily / app.budget_fx_save_monthly
// (security definer, db/modules/budget-fx.sql), which validate them and never
// change a published rate. Read and written by src/modules/budget/fx/rates.ts.
// ---------------------------------------------------------------------------

export const budgetFxSources = ["daily", "monthly"] as const

/**
 * One rate as ČNB published it: `rate` CZK for `units` units of `currency`.
 * daily: the central bank fixing of `valid_on`; monthly: the "other
 * currencies" list valid for the month starting on `valid_on`.
 */
export const budgetFxRates = pgTable(
  "budget_fx_rates",
  {
    source: text("source", { enum: budgetFxSources }).notNull(),
    validOn: date("valid_on", { mode: "string" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    units: integer("units").notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "budget_fx_rates_pkey", columns: [t.source, t.validOn, t.currency] }),
    index("budget_fx_rates_currency_idx").on(t.currency, t.validOn),
    check("budget_fx_rates_source_valid", sql`${t.source} in ('daily', 'monthly')`),
    check("budget_fx_rates_currency_shape", sql`${t.currency} ~ '^[A-Z]{3}$' and ${t.currency} <> 'CZK'`),
    check("budget_fx_rates_units_valid", sql`${t.units} in (1, 10, 100, 1000, 10000, 100000, 1000000)`),
    check("budget_fx_rates_rate_positive", sql`${t.rate} > 0`),
    check("budget_fx_rates_monthly_first", sql`${t.source} = 'daily' or extract(day from ${t.validOn}) = 1`),
  ],
)

/**
 * Which daily fixing applies to a calendar day: what ČNB's daily file answered
 * for it (the day's own fixing, or the latest before it on weekends and
 * holidays). `final` is false for days from "today in Prague" on, since a
 * newer fixing may still be published that day; those rows are re-checked.
 */
export const budgetFxDays = pgTable(
  "budget_fx_days",
  {
    day: date("day", { mode: "string" }).primaryKey(),
    fixingDate: date("fixing_date", { mode: "string" }).notNull(),
    final: boolean("final").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("budget_fx_days_fixing_before_day", sql`${t.fixingDate} <= ${t.day}`)],
)
