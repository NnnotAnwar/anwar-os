import "server-only"
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { InternalApiError } from "@/core/internal-api"
import type { Tx } from "@/db"
import {
  budgetAccounts as a,
  budgetBotHeartbeats as hb,
  budgetCategories as c,
  budgetTransactions as t,
} from "@/db/schema"
import { actions } from "../actions"
import { addDaysIso, monthOf, monthRange, parseIsoDate, todayIn } from "../lib/dates"
import { defaultAccountId, parseQuickAdd } from "../lib/quick-add"
import { BudgetInputError, type Account } from "../schema"
import { BOT_IMPORT_KEY, rankCategories, toBotExpense, type BotCategory, type BotExpense, type CurrencyTotals } from "./lib"
import { limitForExpense, type BotLimit } from "./limits"

// What the expense bot (bots/expenses) can do in Budget, as the site owner.
// Writes go through the Budget module's own actions (createTransaction,
// updateTransaction, deleteTransactions, importTransactions, ensureSetup) and
// its quick-add parser; the reads here are the bot's views of the same tables.
// Every query runs inside asViewer(), so RLS scopes it to the owner.

/** Bot heartbeats older than this mean "not connected". The bot beats every 60 s. */
export const HEARTBEAT_STALE_MS = 3 * 60_000
/** "Frequent first" in the picker looks this far back. */
const USAGE_DAYS = 90

const isoDate = z.string().refine((v) => parseIsoDate(v) !== null, "Use a real date (YYYY-MM-DD).")
const spent = z.number().int().positive("The amount must be above zero.").max(1e13, "That amount is too large.")
const note = z.string().trim().max(500, "Keep the note under 500 characters.")

/** A spending transaction (money out, not a transfer leg). */
const isExpense = and(lt(t.amountMinor, 0), isNull(t.transferId))!

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const expenseColumns = {
  id: t.id,
  amountMinor: t.amountMinor,
  currency: t.currency,
  categoryId: t.categoryId,
  categoryName: c.name,
  note: t.note,
  occurredOn: t.occurredOn,
  createdAt: t.createdAt,
  accountId: t.accountId,
  accountName: a.name,
}

async function selectExpenses(tx: Tx, where: SQL | undefined, { limit, offset = 0, newestFirst = true }: { limit: number; offset?: number; newestFirst?: boolean }) {
  const order = newestFirst ? [desc(t.occurredOn), desc(t.createdAt), desc(t.id)] : [t.occurredOn, t.createdAt, t.id]
  const rows = await tx
    .select(expenseColumns)
    .from(t)
    .innerJoin(a, eq(a.id, t.accountId))
    .leftJoin(c, eq(c.id, t.categoryId))
    .where(and(isExpense, where))
    .orderBy(...order)
    .limit(limit)
    .offset(offset)
  return rows.map(toBotExpense)
}

async function findExpense(tx: Tx, id: string): Promise<BotExpense | null> {
  const [row] = await selectExpenses(tx, eq(t.id, id), { limit: 1 })
  return row ?? null
}

const GONE = "That expense doesn't exist any more."

async function requireExpense(id: string): Promise<BotExpense> {
  const row = await asViewer((tx) => findExpense(tx, id))
  if (!row) throw new InternalApiError(404, "gone", GONE)
  return row
}

/** Spent per currency today and in the current month (in the owner's timezone). */
export async function runningTotals(timezone: string): Promise<{ today: string; month: string; day: CurrencyTotals; monthTotals: CurrencyTotals }> {
  const today = todayIn(timezone)
  const month = monthOf(today)
  const { from, to } = monthRange(month)
  const rows = await asViewer((tx) =>
    tx
      .select({
        currency: t.currency,
        day: sql<string>`coalesce(-sum(${t.amountMinor}) filter (where ${t.occurredOn} = ${today}), 0)`,
        month: sql<string>`coalesce(-sum(${t.amountMinor}), 0)`,
      })
      .from(t)
      .where(and(isExpense, gte(t.occurredOn, from), lte(t.occurredOn, to)))
      .groupBy(t.currency),
  )
  const day: CurrencyTotals = {}
  const monthTotals: CurrencyTotals = {}
  for (const row of rows) {
    if (Number(row.day)) day[row.currency] = Number(row.day)
    if (Number(row.month)) monthTotals[row.currency] = Number(row.month)
  }
  return { today, month, day, monthTotals }
}

type Totals = Awaited<ReturnType<typeof runningTotals>>
const totalsJson = (x: Totals) => ({ today: x.today, month: x.month, day: x.day, monthTotals: x.monthTotals })

// ---------------------------------------------------------------------------
// Setup: accounts, categories, defaults
// ---------------------------------------------------------------------------

export type BotSetup = {
  timezone: string
  today: string
  defaultAccountId: string | null
  /** The default account's currency (CZK when there is no account yet). */
  currency: string
  accounts: Pick<Account, "id" | "name" | "kind" | "currency" | "balanceMinor">[]
  /** Expense categories, most used in the last 90 days first. */
  categories: BotCategory[]
}

export async function setup(timezone: string): Promise<BotSetup> {
  await actions.ensureSetup.handler({})
  const today = todayIn(timezone)
  const [accounts, categories, usage] = await Promise.all([
    actions.listAccounts.handler({ includeArchived: false }),
    actions.listCategories.handler({ includeArchived: false }),
    asViewer((tx) =>
      tx
        .select({
          categoryId: t.categoryId,
          uses: sql<number>`count(*)::int`,
          lastUsedAt: sql<string>`max(${t.createdAt})::text`,
        })
        .from(t)
        .where(and(isExpense, gte(t.occurredOn, addDaysIso(today, -USAGE_DAYS)), sql`${t.categoryId} is not null`))
        .groupBy(t.categoryId),
    ),
  ])
  const expense = categories.filter((x) => x.kind === "expense")
  const names = new Map(categories.map((x) => [x.id, x.name]))
  const ranked = rankCategories(
    expense.map((x) => ({
      id: x.id,
      name: x.name,
      parentId: x.parentId,
      parentName: x.parentId ? (names.get(x.parentId) ?? null) : null,
      color: x.color,
    })),
    usage.map((u) => ({ categoryId: u.categoryId!, uses: u.uses, lastUsedAt: u.lastUsedAt })),
  )
  const defaultId = defaultAccountId(accounts)
  return {
    timezone,
    today,
    defaultAccountId: defaultId,
    currency: accounts.find((x) => x.id === defaultId)?.currency ?? "CZK",
    accounts: accounts.map(({ id, name, kind, currency, balanceMinor }) => ({ id, name, kind, currency, balanceMinor })),
    categories: ranked,
  }
}

async function accountFor(requested: string | null | undefined, preloaded?: Account[]): Promise<string> {
  const accounts = preloaded ?? (await actions.listAccounts.handler({ includeArchived: false }))
  if (requested) {
    if (!accounts.some((x) => x.id === requested)) throw new InternalApiError(422, "no_account", "That account doesn't exist any more.")
    return requested
  }
  const id = defaultAccountId(accounts)
  if (!id) throw new InternalApiError(422, "no_account", "Add an account in Budget first.")
  return id
}

async function checkCategory(categoryId: string | null) {
  if (!categoryId) return
  const [row] = await asViewer((tx) => tx.select({ kind: c.kind, archived: c.archived }).from(c).where(eq(c.id, categoryId)))
  if (!row || row.archived) throw new InternalApiError(422, "no_category", "That category doesn't exist any more.")
  if (row.kind !== "expense") throw new InternalApiError(422, "no_category", "Pick a spending category.")
}

/** Budget's own errors ("That account or category doesn't exist any more.") reach the bot as 422s. */
async function budget<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof BudgetInputError) throw new InternalApiError(422, "rejected", error.message)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const quickInput = z.object({
  /** One line as typed: "250 food lunch", "89,90 coffee yesterday", "coffee 250". */
  text: z.string().trim().min(1, "Send an amount, e.g. 250 coffee.").max(300),
  /** true: when no category is clear, save nothing and say so (the bot then shows its picker). */
  requireCategory: z.boolean().default(true),
  accountId: z.uuid().nullable().optional(),
})

export type QuickResult =
  | { status: "created"; expense: BotExpense; totals: ReturnType<typeof totalsJson>; limit: BotLimit | null; matchedBy: "name" | "note" | null }
  | { status: "needs_category"; draft: { amountMinor: number; note: string; occurredOn: string; currency: string } }

/** The category the owner filed this exact note under most often (case-insensitive), if any. */
async function learnedCategory(tx: Tx, noteText: string): Promise<string | null> {
  if (!noteText) return null
  const [row] = await tx
    .select({ categoryId: t.categoryId })
    .from(t)
    .innerJoin(c, eq(c.id, t.categoryId))
    .where(and(isExpense, eq(c.kind, "expense"), eq(c.archived, false), sql`lower(${t.note}) = lower(${noteText})`))
    .groupBy(t.categoryId)
    .orderBy(sql`count(*) desc`, sql`max(${t.createdAt}) desc`)
    .limit(1)
  return row?.categoryId ?? null
}

/**
 * Parses one line with Budget's quick-add parser, restricted to spending: the
 * category from the words after the amount, else the one this note was filed
 * under before. Creates the expense, or with requireCategory and nothing clear,
 * returns the parsed draft for the bot's category picker.
 */
export async function quickAdd(input: z.infer<typeof quickInput>, timezone: string): Promise<QuickResult> {
  // The first thing a new owner may ever do in Budget: seed its defaults (a no-op afterwards).
  await actions.ensureSetup.handler({})
  const today = todayIn(timezone)
  const [accounts, categories] = await Promise.all([
    actions.listAccounts.handler({ includeArchived: false }),
    actions.listCategories.handler({ includeArchived: false }),
  ])
  const accountId = await accountFor(input.accountId, accounts)
  const parsed = parseQuickAdd(input.text, {
    categories: categories.filter((x) => x.kind === "expense"),
    accounts,
    today,
    defaultAccountId: accountId,
  })
  if (!parsed.ok) throw new InternalApiError(400, "invalid_input", parsed.error)
  if (parsed.amountMinor > 0) throw new InternalApiError(422, "not_expense", "The bot logs spending. Add income in Budget.")

  let categoryId = parsed.categoryId
  let matchedBy: "name" | "note" | null = categoryId ? "name" : null
  if (!categoryId) {
    categoryId = await asViewer((tx) => learnedCategory(tx, parsed.note))
    if (categoryId) matchedBy = "note"
  }
  const account = accounts.find((x) => x.id === parsed.accountId)
  if (!categoryId && input.requireCategory) {
    return {
      status: "needs_category",
      draft: { amountMinor: -parsed.amountMinor, note: parsed.note, occurredOn: parsed.occurredOn, currency: account?.currency ?? "CZK" },
    }
  }
  const expense = await insertExpense(
    { amountMinor: -parsed.amountMinor, categoryId, note: parsed.note, occurredOn: parsed.occurredOn, tags: parsed.tags },
    parsed.accountId ?? accountId,
    timezone,
  )
  return { status: "created", matchedBy, ...expense }
}

export const createInput = z.object({
  amountMinor: spent,
  categoryId: z.uuid().nullable().default(null),
  note: note.default(""),
  /** Default: today in the owner's timezone. */
  occurredOn: isoDate.optional(),
  accountId: z.uuid().nullable().optional(),
})

export async function create(input: z.infer<typeof createInput>, timezone: string) {
  await checkCategory(input.categoryId)
  return insertExpense(input, await accountFor(input.accountId), timezone)
}

async function insertExpense(
  input: { amountMinor: number; categoryId: string | null; note: string; occurredOn?: string; tags?: string[] },
  accountId: string,
  timezone: string,
): Promise<{ expense: BotExpense; totals: ReturnType<typeof totalsJson>; limit: BotLimit | null }> {
  const { id } = await budget(() =>
    actions.createTransaction.handler({
      accountId,
      categoryId: input.categoryId,
      amountMinor: -input.amountMinor,
      occurredOn: input.occurredOn ?? todayIn(timezone),
      note: input.note,
      tags: input.tags ?? [],
    }),
  )
  const [expense, totals] = await Promise.all([requireExpense(id), runningTotals(timezone)])
  // The category's monthly limit as it stands now ("Food: 800 of 6 000 left").
  return { expense, totals: totalsJson(totals), limit: await limitForExpense(expense) }
}

// ---------------------------------------------------------------------------
// One expense: get, update, delete
// ---------------------------------------------------------------------------

export const idQuery = z.object({ id: z.uuid("Not an expense id.") })

export async function getExpense(id: string, timezone: string) {
  const [expense, totals] = await Promise.all([requireExpense(id), runningTotals(timezone)])
  return { expense, totals: totalsJson(totals) }
}

export const updateInput = z
  .object({
    id: z.uuid("Not an expense id."),
    amountMinor: spent.optional(),
    /** null = uncategorised. */
    categoryId: z.uuid().nullable().optional(),
    /** "" clears it. */
    note: note.optional(),
    occurredOn: isoDate.optional(),
  })
  .refine((v) => v.amountMinor !== undefined || v.categoryId !== undefined || v.note !== undefined || v.occurredOn !== undefined, "Nothing to change.")

export async function updateExpense(input: z.infer<typeof updateInput>, timezone: string) {
  const current = await requireExpense(input.id)
  if (input.categoryId !== undefined) await checkCategory(input.categoryId)
  const [row] = await asViewer((tx) => tx.select({ tags: t.tags }).from(t).where(eq(t.id, input.id)))
  await budget(() =>
    actions.updateTransaction.handler({
      id: input.id,
      accountId: current.accountId,
      categoryId: input.categoryId !== undefined ? input.categoryId : current.categoryId,
      amountMinor: -(input.amountMinor ?? current.amountMinor),
      occurredOn: input.occurredOn ?? current.occurredOn,
      note: input.note ?? current.note,
      tags: row?.tags ?? [],
    }),
  )
  const updated = await getExpense(input.id, timezone)
  return { ...updated, limit: await limitForExpense(updated.expense) }
}

/** Deletes one expense; returns it as it was (for the bot's "Removed" line). */
export async function deleteExpense(id: string, timezone: string) {
  const expense = await requireExpense(id)
  const { deleted } = await actions.deleteTransactions.handler({ ids: [id] })
  if (!deleted) throw new InternalApiError(404, "gone", GONE)
  return { expense, totals: totalsJson(await runningTotals(timezone)) }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const recentInput = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})

/** A page of expenses, newest first (by day, then when recorded), and how many there are. */
export async function recent({ limit, offset }: z.infer<typeof recentInput>) {
  return asViewer(async (tx) => {
    const [items, [count]] = await Promise.all([
      selectExpenses(tx, undefined, { limit, offset }),
      tx.select({ n: sql<number>`count(*)::int` }).from(t).where(isExpense),
    ])
    return { items, total: count?.n ?? 0 }
  })
}

export const MAX_RANGE_ROWS = 5000

export const rangeInput = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, "from must not be after to.")
  .refine((v) => v.to <= addDaysIso(v.from, 400), "Ask for at most about a year at a time.")

/**
 * Every expense with occurredOn in [from, to] (inclusive), oldest first. The
 * bot builds its day/week/month summaries, comparisons and CSV from these.
 */
export async function range({ from, to }: z.infer<typeof rangeInput>) {
  const items = await asViewer((tx) =>
    selectExpenses(tx, and(gte(t.occurredOn, from), lte(t.occurredOn, to)), { limit: MAX_RANGE_ROWS + 1, newestFirst: false }),
  )
  return { items: items.slice(0, MAX_RANGE_ROWS), truncated: items.length > MAX_RANGE_ROWS }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const heartbeatInput = z.object({
  version: z.string().trim().min(1).max(80).default("dev"),
  startedAt: z.coerce.date(),
})

export async function heartbeat({ version, startedAt }: z.infer<typeof heartbeatInput>): Promise<void> {
  await asViewer(async (tx) => {
    const now = new Date()
    await tx
      .insert(hb)
      .values({ version, startedAt, lastBeatAt: now })
      .onConflictDoUpdate({ target: hb.ownerId, set: { version, startedAt, lastBeatAt: now } })
  })
}

export type BudgetBotStatus = {
  configured: boolean
  connected: boolean
  lastBeatAt: string | null
  version: string | null
  startedAt: string | null
}

/** The Bots panel: is the expense bot alive? Runs as the current viewer. */
export async function budgetBotStatus(now = new Date()): Promise<BudgetBotStatus> {
  const [row] = await asViewer((tx) => tx.select().from(hb).where(eq(hb.ownerId, sql`app.current_user_id()`)))
  return {
    configured: Boolean(process.env.BOT_EXPENSES_API_SECRET),
    connected: Boolean(row && now.getTime() - row.lastBeatAt.getTime() < HEARTBEAT_STALE_MS),
    lastBeatAt: row?.lastBeatAt.toISOString() ?? null,
    version: row?.version ?? null,
    startedAt: row?.startedAt.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// One-time import of the bot's own database (python -m expenses_bot import-to-budget)
// ---------------------------------------------------------------------------

export const MAX_IMPORT_BATCH = 500

export const importInput = z.object({
  accountId: z.uuid().nullable().optional(),
  /** Only report what would happen. */
  dryRun: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        /** "bot-expenses:<id>": the row's id in bot_expenses.expenses. */
        key: z.string().regex(BOT_IMPORT_KEY, "Keys look like bot-expenses:<id>."),
        amountMinor: spent,
        currency: z.string().regex(/^[A-Z]{3}$/),
        /** The day in the owner's timezone. */
        occurredOn: isoDate,
        /** The original instant. */
        recordedAt: z.iso.datetime({ offset: true }),
        categoryName: z.string().trim().max(60).nullable().default(null),
        note: z.string().max(500).default(""),
      }),
    )
    .min(1)
    .max(MAX_IMPORT_BATCH),
})

export type ImportResult = {
  dryRun: boolean
  accountId: string
  imported: number
  /** Already in Budget (imported before), by key. */
  existing: number
}

/** Copies the bot's old rows into Budget through importTransactions; each key is imported once, ever. */
export async function importRows(input: z.infer<typeof importInput>): Promise<ImportResult> {
  const accountId = await accountFor(input.accountId)
  const account = (await actions.listAccounts.handler({ includeArchived: false })).find((x) => x.id === accountId)!
  const foreign = input.rows.find((r) => r.currency !== account.currency)
  if (foreign) {
    throw new InternalApiError(
      422,
      "currency_mismatch",
      `${foreign.key} is in ${foreign.currency} but the account “${account.name}” is in ${account.currency}.`,
    )
  }
  if (input.dryRun) {
    const keys = input.rows.map((r) => r.key)
    const [row] = await asViewer((tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(t).where(inArray(t.importKey, keys)),
    )
    const existing = row?.n ?? 0
    return { dryRun: true, accountId, imported: new Set(keys).size - existing, existing }
  }
  const { ids, skipped } = await budget(() =>
    actions.importTransactions.handler({
      accountId,
      rows: input.rows.map((r) => ({
        occurredOn: r.occurredOn,
        amountMinor: -r.amountMinor,
        note: r.note,
        categoryName: r.categoryName,
        importKey: r.key,
        recordedAt: r.recordedAt,
      })),
    }),
  )
  return { dryRun: false, accountId, imported: ids.length, existing: skipped }
}
