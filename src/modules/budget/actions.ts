import "server-only"
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import {
  budgetAccounts as a,
  budgetCategories as c,
  budgetGoals as g,
  budgetPlans as p,
  budgetRecurring as r,
  budgetSettings as s,
  budgetTransactions as t,
} from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { amountQuery } from "./lib/amount-search"
import { dedupeKey, markDuplicates } from "./lib/csv"
import { monthOf, monthRange, todayIn } from "./lib/dates"
import { savingsRate } from "./lib/money"
import { actualMonths, comparePlan, netWorthByMonth, projectPlan, type ComparisonRow } from "./lib/projection"
import { defaultAccountId, parseQuickAdd } from "./lib/quick-add"
import { dueDates } from "./lib/recurring"
import {
  archiveInput,
  BudgetInputError,
  createAccountInput,
  createCategoryInput,
  createGoalInput,
  createRecurringInput,
  createTransactionInput,
  existingKeysInput,
  idInput,
  idsInput,
  importInput,
  listTransactionsInput,
  monthInput,
  planInput,
  quickAddInput,
  setActiveInput,
  transferInput,
  updateAccountInput,
  updateCategoryInput,
  updateGoalInput,
  updateRecurringInput,
  updateTransactionInput,
  type Account,
  type Category,
  type CategoryTotal,
  type Goal,
  type Overview,
  type PlanRow,
  type Recurring,
  type Transaction,
} from "./schema"

// ---------------------------------------------------------------------------
// Defaults, seeded once per user (on the first visit) by ensureSetup.
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORIES: { name: string; kind: "income" | "expense"; color: string }[] = [
  { name: "Food", kind: "expense", color: "teal" },
  { name: "Eating out", kind: "expense", color: "orange" },
  { name: "Housing", kind: "expense", color: "accent-700" },
  { name: "Utilities", kind: "expense", color: "slate" },
  { name: "Transport", kind: "expense", color: "sky" },
  { name: "Health", kind: "expense", color: "fuchsia" },
  { name: "Shopping", kind: "expense", color: "amber" },
  { name: "Fun", kind: "expense", color: "accent-300" },
  { name: "Subscriptions", kind: "expense", color: "accent-500" },
  { name: "Travel", kind: "expense", color: "sky" },
  { name: "Gifts", kind: "expense", color: "fuchsia" },
  { name: "Education", kind: "expense", color: "teal" },
  { name: "Other", kind: "expense", color: "slate" },
  { name: "Salary", kind: "income", color: "accent-500" },
  { name: "Side income", kind: "income", color: "teal" },
  { name: "Interest", kind: "income", color: "accent-300" },
  { name: "Refunds", kind: "income", color: "slate" },
  { name: "Other income", kind: "income", color: "slate" },
]

async function viewerToday() {
  const viewer = await requireViewer()
  return todayIn(viewer.timezone)
}

/** Seeds settings, default categories and one account the first time; a no-op afterwards. */
async function seedIfNew(tx: Tx): Promise<boolean> {
  const inserted = await tx.execute<{ id: string }>(
    sql`insert into budget_settings (base_currency) values ('CZK') on conflict (owner_id) do nothing returning id`,
  )
  if (inserted.length === 0) return false
  await tx.insert(c).values(DEFAULT_CATEGORIES).onConflictDoNothing()
  const [existing] = await tx.select({ id: a.id }).from(a).limit(1)
  if (!existing) await tx.insert(a).values({ name: "Main account", kind: "bank", currency: "CZK" })
  return true
}

async function baseCurrency(tx: Tx) {
  const [row] = await tx.select({ currency: s.baseCurrency }).from(s).limit(1)
  return row?.currency ?? "CZK"
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const notTransfer = isNull(t.transferId)

async function loadAccounts(tx: Tx, includeArchived: boolean): Promise<Account[]> {
  const rows = await tx
    .select({
      id: a.id,
      name: a.name,
      kind: a.kind,
      currency: a.currency,
      openingBalanceMinor: a.openingBalanceMinor,
      openedOn: a.openedOn,
      archived: a.archived,
      sum: sql<string>`coalesce(sum(${t.amountMinor}), 0)`,
      count: sql<number>`count(${t.id})::int`,
    })
    .from(a)
    .leftJoin(t, eq(t.accountId, a.id))
    .where(includeArchived ? undefined : eq(a.archived, false))
    .groupBy(a.id)
    .orderBy(asc(a.archived), asc(a.name))
  return rows.map(({ sum, count, ...row }) => ({
    ...row,
    balanceMinor: row.openingBalanceMinor + Number(sum),
    transactionCount: count,
  }))
}

async function loadCategories(tx: Tx, includeArchived: boolean): Promise<Category[]> {
  const rows = await tx
    .select({
      id: c.id,
      name: c.name,
      kind: c.kind,
      parentId: c.parentId,
      color: c.color,
      archived: c.archived,
      // Spelled out: drizzle renders ${c.id} unqualified here, which would bind to x.id.
      count: sql<number>`(select count(*)::int from budget_transactions x where x.category_id = budget_categories.id)`,
    })
    .from(c)
    .where(includeArchived ? undefined : eq(c.archived, false))
    .orderBy(asc(c.kind), asc(c.name))
  return rows.map(({ count, ...row }) => ({ ...row, transactionCount: count }))
}

const transactionColumns = {
  id: t.id,
  accountId: t.accountId,
  accountName: a.name,
  currency: t.currency,
  categoryId: t.categoryId,
  categoryName: c.name,
  categoryColor: c.color,
  amountMinor: t.amountMinor,
  occurredOn: t.occurredOn,
  note: t.note,
  tags: t.tags,
  recurringId: t.recurringId,
  transferId: t.transferId,
}

async function loadTransactions(tx: Tx, input: z.infer<typeof listTransactionsInput>): Promise<Transaction[]> {
  const range = input.month ? monthRange(input.month) : null
  const from = input.from ?? range?.from
  const to = input.to ?? range?.to
  const pattern = input.query ? likeContains(input.query) : null
  // "250" also finds the amount (abs(amount_minor) is indexed: db/modules/search.sql).
  const amount = input.query ? amountQuery(input.query) : null
  return tx
    .select(transactionColumns)
    .from(t)
    .innerJoin(a, eq(a.id, t.accountId))
    .leftJoin(c, eq(c.id, t.categoryId))
    .where(
      and(
        from ? gte(t.occurredOn, from) : undefined,
        to ? lte(t.occurredOn, to) : undefined,
        input.accountId ? eq(t.accountId, input.accountId) : undefined,
        input.categoryId ? or(eq(t.categoryId, input.categoryId), eq(c.parentId, input.categoryId)) : undefined,
        input.uncategorized ? isNull(t.categoryId) : undefined,
        pattern
          ? or(
              ilike(t.note, pattern),
              ilike(c.name, pattern),
              sql`exists (select 1 from unnest(${t.tags}) tag where tag ilike ${pattern})`,
              amount
                ? and(
                    sql`abs(${t.amountMinor}) between ${amount.min} and ${amount.max}`,
                    amount.sign === "-" ? sql`${t.amountMinor} < 0` : amount.sign === "+" ? sql`${t.amountMinor} > 0` : undefined,
                  )
                : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(t.occurredOn), desc(t.createdAt))
    .limit(input.limit)
}

async function loadOverview(tx: Tx, month: string, today: string): Promise<Overview> {
  const base = await baseCurrency(tx)
  const { from, to } = monthRange(month)
  const inMonth = and(gte(t.occurredOn, from), lte(t.occurredOn, to), notTransfer)

  const [totals, spending, accounts] = await Promise.all([
    tx
      .select({
        currency: t.currency,
        income: sql<string>`coalesce(sum(${t.amountMinor}) filter (where ${t.amountMinor} > 0), 0)`,
        expense: sql<string>`coalesce(-sum(${t.amountMinor}) filter (where ${t.amountMinor} < 0), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(t)
      .where(inMonth)
      .groupBy(t.currency),
    // Spending rolls subcategories up into their parent.
    tx.execute<{ id: string | null; name: string | null; color: string | null; amount: string }>(sql`
      select coalesce(parent.id, cat.id) as id,
             coalesce(parent.name, cat.name) as name,
             coalesce(parent.color, cat.color) as color,
             -sum(tr.amount_minor) as amount
      from budget_transactions tr
      left join budget_categories cat on cat.id = tr.category_id
      left join budget_categories parent on parent.id = cat.parent_id
      where tr.occurred_on between ${from} and ${to}
        and tr.transfer_id is null
        and tr.amount_minor < 0
        and tr.currency = ${base}
      group by 1, 2, 3
      order by amount desc`),
    loadAccounts(tx, false),
  ])

  const main = totals.find((x) => x.currency === base)
  const income = Number(main?.income ?? 0)
  const expense = Number(main?.expense ?? 0)
  const categoryTotals: CategoryTotal[] = spending.map((row) => ({
    id: row.id,
    name: row.name ?? "Uncategorised",
    color: row.color,
    amountMinor: Number(row.amount),
  }))
  return {
    month,
    today,
    baseCurrency: base,
    incomeMinor: income,
    expenseMinor: expense,
    netMinor: income - expense,
    savingsRate: savingsRate(income, expense),
    spending: categoryTotals,
    otherCurrencies: totals
      .filter((x) => x.currency !== base)
      .map((x) => ({ currency: x.currency, incomeMinor: Number(x.income), expenseMinor: Number(x.expense) })),
    accounts,
    transactionCount: totals.reduce((n, x) => n + x.count, 0),
  }
}

/** Throws a friendly error when a category id is set but its kind doesn't fit the parent rule. */
async function checkParent(tx: Tx, parentId: string | null, kind: string, selfId?: string) {
  if (!parentId) return
  if (parentId === selfId) throw new BudgetInputError("A category can't be its own parent.")
  const [parent] = await tx.select({ kind: c.kind, parentId: c.parentId }).from(c).where(eq(c.id, parentId))
  if (!parent) throw new BudgetInputError("That parent category doesn't exist.")
  if (parent.parentId) throw new BudgetInputError("Pick a top-level category as the parent.")
  if (parent.kind !== kind) throw new BudgetInputError("A subcategory must be the same kind as its parent.")
  if (selfId) {
    const [child] = await tx.select({ id: c.id }).from(c).where(eq(c.parentId, selfId)).limit(1)
    if (child) throw new BudgetInputError("This category has subcategories, so it has to stay top-level.")
  }
}

function friendly(error: unknown): never {
  const code = (error as { code?: string; cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code
  if (code === "23505") throw new BudgetInputError("Something with that name already exists.")
  if (code === "23503") throw new BudgetInputError("That account or category doesn't exist any more.")
  throw error
}

// ---------------------------------------------------------------------------
// The module's operations. Descriptions are written for an LLM caller.
// Amounts are integer minor units (1 CZK = 100); negative = money out.
// ---------------------------------------------------------------------------

export const actions = {
  ensureSetup: defineAction({
    description:
      "Prepare the budget for first use: creates the user's settings, a default set of income and expense categories and one 'Main account' (CZK). Safe to call repeatedly; returns true only the first time.",
    kind: "write",
    input: z.object({}),
    handler: (): Promise<boolean> => asViewer(seedIfNew),
  }),

  overview: defineAction({
    description:
      "Summary of one month (default: the current month in the user's timezone): income, spending and net in the base currency (transfers between own accounts excluded), savings rate in percent, spending per top-level category, totals in other currencies, and every open account with its balance.",
    kind: "read",
    input: monthInput,
    handler: async ({ month }): Promise<Overview> => {
      const today = await viewerToday()
      return asViewer((tx) => loadOverview(tx, month ?? monthOf(today), today))
    },
  }),

  listTransactions: defineAction({
    description:
      "List transactions, newest first. Filter by month (YYYY-MM) or from/to dates, account, category (includes its subcategories), uncategorised only, or text in the note, category name or tags. amountMinor is signed: negative = spent, positive = received.",
    kind: "read",
    input: listTransactionsInput,
    handler: (input): Promise<Transaction[]> => asViewer((tx) => loadTransactions(tx, input)),
  }),

  getTransaction: defineAction({
    description: "Get one transaction by id, or null.",
    kind: "read",
    input: idInput,
    handler: ({ id }): Promise<Transaction | null> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .select(transactionColumns)
          .from(t)
          .innerJoin(a, eq(a.id, t.accountId))
          .leftJoin(c, eq(c.id, t.categoryId))
          .where(eq(t.id, id))
        return row ?? null
      }),
  }),

  createTransaction: defineAction({
    description:
      "Record a transaction on an account. amountMinor is signed minor units (−25000 = spent 250.00; +4500000 = received 45,000.00). The currency is the account's. categoryId, note and tags are optional.",
    kind: "write",
    input: createTransactionInput,
    handler: (input): Promise<{ id: string }> =>
      asViewer(async (tx) => {
        try {
          const [row] = await tx.insert(t).values(input).returning({ id: t.id })
          return { id: row!.id }
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  quickAdd: defineAction({
    description:
      "Record a transaction from one line of text, e.g. '250 food lunch' (spent 250 in Food, note 'lunch'), '+45000 salary', '89,90 eating out @cash #coffee yesterday'. A bare number is spending unless the category is an income category. Returns the created transaction.",
    kind: "write",
    input: quickAddInput,
    handler: async ({ text, accountId }): Promise<Transaction> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const [accounts, categories] = await Promise.all([loadAccounts(tx, false), loadCategories(tx, false)])
        const parsed = parseQuickAdd(text, { categories, accounts, today, defaultAccountId: defaultAccountId(accounts, accountId) })
        if (!parsed.ok) throw new BudgetInputError(parsed.error)
        if (!parsed.accountId) throw new BudgetInputError("Add an account first.")
        const [row] = await tx
          .insert(t)
          .values({
            accountId: parsed.accountId,
            categoryId: parsed.categoryId,
            amountMinor: parsed.amountMinor,
            occurredOn: parsed.occurredOn,
            note: parsed.note,
            tags: parsed.tags,
          })
          .returning({ id: t.id })
        const [created] = await tx
          .select(transactionColumns)
          .from(t)
          .innerJoin(a, eq(a.id, t.accountId))
          .leftJoin(c, eq(c.id, t.categoryId))
          .where(eq(t.id, row!.id))
        return created!
      })
    },
  }),

  updateTransaction: defineAction({
    description: "Replace a transaction's account, category, signed amount, date, note and tags.",
    kind: "write",
    input: updateTransactionInput,
    handler: ({ id, ...fields }): Promise<void> =>
      asViewer(async (tx) => {
        try {
          const [row] = await tx.update(t).set(fields).where(eq(t.id, id)).returning({ id: t.id })
          if (!row) throw new BudgetInputError("That transaction doesn't exist any more.")
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  deleteTransactions: defineAction({
    description:
      "Permanently delete transactions by id. Deleting one leg of a transfer deletes both legs.",
    kind: "write",
    input: idsInput,
    handler: ({ ids }): Promise<{ deleted: number }> =>
      asViewer(async (tx) => {
        const legs = await tx
          .select({ transferId: t.transferId })
          .from(t)
          .where(and(inArray(t.id, ids), sql`${t.transferId} is not null`))
        const transferIds = legs.map((l) => l.transferId!).filter(Boolean)
        const deleted = await tx
          .delete(t)
          .where(or(inArray(t.id, ids), transferIds.length ? inArray(t.transferId, transferIds) : undefined))
          .returning({ id: t.id })
        return { deleted: deleted.length }
      }),
  }),

  transfer: defineAction({
    description:
      "Move money between two of the user's own accounts (same currency). Creates two linked transactions that reports leave out of income and spending.",
    kind: "write",
    input: transferInput,
    handler: (input): Promise<{ transferId: string }> =>
      asViewer(async (tx) => {
        if (input.fromAccountId === input.toAccountId) throw new BudgetInputError("Pick two different accounts.")
        const rows = await tx
          .select({ id: a.id, currency: a.currency })
          .from(a)
          .where(inArray(a.id, [input.fromAccountId, input.toAccountId]))
        if (rows.length !== 2) throw new BudgetInputError("Both accounts must exist.")
        if (rows[0]!.currency !== rows[1]!.currency)
          throw new BudgetInputError("Transfers work between accounts in the same currency.")
        const transferId = crypto.randomUUID()
        const note = input.note
        await tx.insert(t).values([
          { accountId: input.fromAccountId, amountMinor: -input.amountMinor, occurredOn: input.occurredOn, note, transferId },
          { accountId: input.toAccountId, amountMinor: input.amountMinor, occurredOn: input.occurredOn, note, transferId },
        ])
        return { transferId }
      }),
  }),

  // Accounts ----------------------------------------------------------------

  listAccounts: defineAction({
    description:
      "List the user's accounts (cash, bank, savings, investment) with currency, opening balance and current balance (opening + all transactions). Archived accounts only when asked.",
    kind: "read",
    input: z.object({ includeArchived: z.boolean().default(false) }),
    handler: ({ includeArchived }): Promise<Account[]> => asViewer((tx) => loadAccounts(tx, includeArchived)),
  }),

  createAccount: defineAction({
    description:
      "Add an account. kind is cash, bank, savings or investment; currency is an ISO code (default CZK); openingBalanceMinor is the balance on openedOn (default today).",
    kind: "write",
    input: createAccountInput,
    handler: async (input): Promise<{ id: string }> => {
      const openedOn = input.openedOn ?? (await viewerToday())
      return asViewer(async (tx) => {
        const [row] = await tx.insert(a).values({ ...input, openedOn }).returning({ id: a.id })
        return { id: row!.id }
      })
    },
  }),

  updateAccount: defineAction({
    description:
      "Rename an account or change its kind, currency, opening balance or opening date. Changing the currency relabels its transactions without converting amounts.",
    kind: "write",
    input: updateAccountInput,
    handler: ({ id, openedOn, ...fields }): Promise<void> =>
      asViewer(async (tx) => {
        await tx
          .update(a)
          .set({ ...fields, ...(openedOn ? { openedOn } : {}) })
          .where(eq(a.id, id))
      }),
  }),

  archiveAccount: defineAction({
    description: "Archive an account (hidden from lists and quick add, kept in history) or bring it back.",
    kind: "write",
    input: archiveInput,
    handler: ({ id, archived }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(a).set({ archived }).where(eq(a.id, id))
      }),
  }),

  deleteAccount: defineAction({
    description: "Permanently delete an account that has no transactions (its recurring templates go with it). Archive accounts with history instead.",
    kind: "write",
    input: idInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        try {
          await tx.delete(a).where(eq(a.id, id))
        } catch (e) {
          const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string }).code
          if (code === "23503") throw new BudgetInputError("This account has transactions. Archive it instead.")
          throw e
        }
      }),
  }),

  // Categories --------------------------------------------------------------

  listCategories: defineAction({
    description:
      "List income and expense categories with their parent (one level of subcategories), colour token and how many transactions use each.",
    kind: "read",
    input: z.object({ includeArchived: z.boolean().default(false) }),
    handler: ({ includeArchived }): Promise<Category[]> => asViewer((tx) => loadCategories(tx, includeArchived)),
  }),

  createCategory: defineAction({
    description: "Add an income or expense category, optionally under a top-level parent of the same kind.",
    kind: "write",
    input: createCategoryInput,
    handler: (input): Promise<{ id: string }> =>
      asViewer(async (tx) => {
        await checkParent(tx, input.parentId, input.kind)
        try {
          const [row] = await tx.insert(c).values(input).returning({ id: c.id })
          return { id: row!.id }
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  updateCategory: defineAction({
    description: "Rename a category or change its kind, parent or colour.",
    kind: "write",
    input: updateCategoryInput,
    handler: ({ id, ...fields }): Promise<void> =>
      asViewer(async (tx) => {
        await checkParent(tx, fields.parentId, fields.kind, id)
        try {
          await tx.update(c).set(fields).where(eq(c.id, id))
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  archiveCategory: defineAction({
    description: "Archive a category (hidden from pickers, kept on old transactions) or bring it back.",
    kind: "write",
    input: archiveInput,
    handler: ({ id, archived }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(c).set({ archived }).where(eq(c.id, id))
      }),
  }),

  deleteCategory: defineAction({
    description: "Permanently delete a category. Its transactions become uncategorised; its subcategories become top-level.",
    kind: "write",
    input: idInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(c).where(eq(c.id, id))
      }),
  }),

  // Recurring ---------------------------------------------------------------

  listRecurring: defineAction({
    description:
      "List recurring templates (rent, salary, subscriptions): signed amount, account, category, rule (every N weeks/months/years from startOn), next due date and whether active.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<Recurring[]> =>
      asViewer((tx) =>
        tx
          .select({
            id: r.id,
            accountId: r.accountId,
            accountName: a.name,
            currency: r.currency,
            categoryId: r.categoryId,
            categoryName: c.name,
            amountMinor: r.amountMinor,
            note: r.note,
            tags: r.tags,
            freq: r.freq,
            interval: r.interval,
            startOn: r.startOn,
            nextDue: r.nextDue,
            endOn: r.endOn,
            active: r.active,
          })
          .from(r)
          .innerJoin(a, eq(a.id, r.accountId))
          .leftJoin(c, eq(c.id, r.categoryId))
          .orderBy(desc(r.active), asc(r.nextDue), asc(r.note)),
      ),
  }),

  dueCount: defineAction({
    description: "How many active recurring templates have an occurrence due today or earlier.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<number> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(r)
          .where(and(eq(r.active, true), lte(r.nextDue, today)))
        return row?.n ?? 0
      })
    },
  }),

  createRecurring: defineAction({
    description:
      "Add a recurring template. freq is weekly, monthly or yearly, every `interval` periods from startOn (a 31st falls on the last day of shorter months). Occurrences become transactions when generateDue runs; a start in the past back-fills.",
    kind: "write",
    input: createRecurringInput,
    handler: (input): Promise<{ id: string }> =>
      asViewer(async (tx) => {
        try {
          const [row] = await tx
            .insert(r)
            .values({ ...input, nextDue: input.startOn })
            .returning({ id: r.id })
          return { id: row!.id }
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  updateRecurring: defineAction({
    description:
      "Change a recurring template. Already generated transactions stay as they are; if the start date changes, the next due date restarts from it (dates already generated are skipped).",
    kind: "write",
    input: updateRecurringInput,
    handler: ({ id, ...fields }): Promise<void> =>
      asViewer(async (tx) => {
        const [current] = await tx.select({ startOn: r.startOn, nextDue: r.nextDue }).from(r).where(eq(r.id, id))
        if (!current) throw new BudgetInputError("That template doesn't exist any more.")
        const nextDue = current.startOn === fields.startOn ? current.nextDue : fields.startOn
        try {
          await tx.update(r).set({ ...fields, nextDue }).where(eq(r.id, id))
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  setRecurringActive: defineAction({
    description: "Pause or resume a recurring template.",
    kind: "write",
    input: setActiveInput,
    handler: ({ id, active }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(r).set({ active }).where(eq(r.id, id))
      }),
  }),

  deleteRecurring: defineAction({
    description: "Delete a recurring template. Transactions it already created are kept.",
    kind: "write",
    input: idInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(r).where(eq(r.id, id))
      }),
  }),

  generateDue: defineAction({
    description:
      "Create the transactions every active recurring template owes up to today (in the user's timezone) and move each template's next due date forward. Idempotent: running it twice creates nothing the second time. Returns how many transactions were created.",
    kind: "write",
    input: z.object({}),
    handler: async (): Promise<{ created: number; templates: number }> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        // Row locks: two concurrent runs can't both generate the same template.
        const due = await tx
          .select()
          .from(r)
          .where(and(eq(r.active, true), lte(r.nextDue, today)))
          .for("update")
        let created = 0
        for (const tpl of due) {
          const { dates, nextDue } = dueDates(tpl, tpl.nextDue, today)
          if (dates.length) {
            const inserted = await tx
              .insert(t)
              .values(
                dates.map((occurredOn) => ({
                  accountId: tpl.accountId,
                  categoryId: tpl.categoryId,
                  amountMinor: tpl.amountMinor,
                  occurredOn,
                  note: tpl.note,
                  tags: tpl.tags,
                  recurringId: tpl.id,
                })),
              )
              .onConflictDoNothing({ target: [t.recurringId, t.occurredOn] })
              .returning({ id: t.id })
            created += inserted.length
          }
          await tx
            .update(r)
            .set(nextDue ? { nextDue } : { active: false, nextDue: dates.at(-1) ?? tpl.nextDue })
            .where(eq(r.id, tpl.id))
        }
        return { created, templates: due.length }
      })
    },
  }),

  // Goals -------------------------------------------------------------------

  listGoals: defineAction({
    description:
      "List savings goals with target, deadline and progress: the linked account's current balance, or the manually saved amount when no account is linked.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<Goal[]> =>
      asViewer(async (tx) => {
        const [goals, accounts] = await Promise.all([
          tx.select().from(g).where(eq(g.archived, false)).orderBy(asc(g.deadline), asc(g.name)),
          loadAccounts(tx, true),
        ])
        return goals.map((goal) => {
          const account = goal.accountId ? accounts.find((x) => x.id === goal.accountId) : undefined
          return {
            id: goal.id,
            name: goal.name,
            targetMinor: goal.targetMinor,
            currency: account?.currency ?? goal.currency,
            deadline: goal.deadline,
            accountId: goal.accountId,
            accountName: account?.name ?? null,
            savedMinor: goal.savedMinor,
            progressMinor: account ? Math.max(0, account.balanceMinor) : goal.savedMinor,
          }
        })
      }),
  }),

  createGoal: defineAction({
    description:
      "Add a savings goal: name, target amount (minor units), optional deadline, and either a linked account (progress follows its balance) or a manually saved amount.",
    kind: "write",
    input: createGoalInput,
    handler: (input): Promise<{ id: string }> =>
      asViewer(async (tx) => {
        try {
          const [row] = await tx.insert(g).values(input).returning({ id: g.id })
          return { id: row!.id }
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  updateGoal: defineAction({
    description: "Change a savings goal's name, target, deadline, linked account or saved amount.",
    kind: "write",
    input: updateGoalInput,
    handler: ({ id, ...fields }): Promise<void> =>
      asViewer(async (tx) => {
        try {
          await tx.update(g).set(fields).where(eq(g.id, id))
        } catch (e) {
          friendly(e)
        }
      }),
  }),

  deleteGoal: defineAction({
    description: "Permanently delete a savings goal (the linked account is untouched).",
    kind: "write",
    input: idInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(g).where(eq(g.id, id))
      }),
  }),

  // Plan --------------------------------------------------------------------

  getPlan: defineAction({
    description:
      "The capital-growth plan (starting capital, monthly contribution, expected annual return in basis points, horizon in years, start month) compared month by month with actual net worth: the sum of balances of accounts in the plan's currency at each month's end. Null plan when none is saved.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<{ plan: PlanRow | null; rows: ComparisonRow[]; currentMonth: string }> => {
      const currentMonth = monthOf(await viewerToday())
      return asViewer(async (tx) => {
        const [plan] = await tx
          .select({
            startingCapitalMinor: p.startingCapitalMinor,
            monthlyContributionMinor: p.monthlyContributionMinor,
            annualReturnBp: p.annualReturnBp,
            horizonYears: p.horizonYears,
            startOn: p.startOn,
            currency: p.currency,
          })
          .from(p)
          .limit(1)
        if (!plan) return { plan: null, rows: [], currentMonth }
        const months = actualMonths(plan, currentMonth)
        const [accounts, sums] = await Promise.all([
          tx
            .select({ openingBalanceMinor: a.openingBalanceMinor, openedOn: a.openedOn })
            .from(a)
            .where(eq(a.currency, plan.currency)),
          tx
            .select({
              month: sql<string>`to_char(${t.occurredOn}, 'YYYY-MM')`,
              sum: sql<string>`sum(${t.amountMinor})`,
            })
            .from(t)
            .where(eq(t.currency, plan.currency))
            .groupBy(sql`1`),
        ])
        const actual = netWorthByMonth(accounts, new Map(sums.map((x) => [x.month, Number(x.sum)])), months)
        return { plan, rows: comparePlan(projectPlan(plan), actual, currentMonth), currentMonth }
      })
    },
  }),

  savePlan: defineAction({
    description:
      "Create or replace the capital-growth plan. annualReturnBp is basis points (700 = 7 %); startMonth is YYYY-MM.",
    kind: "write",
    input: planInput,
    handler: ({ startMonth, ...fields }): Promise<void> =>
      asViewer(async (tx) => {
        const values = { ...fields, startOn: `${startMonth}-01` }
        await tx.insert(p).values(values).onConflictDoUpdate({ target: p.ownerId, set: values })
      }),
  }),

  // Import ------------------------------------------------------------------

  existingKeys: defineAction({
    description:
      "Duplicate-detection keys (date|amount|normalised note) of an account's transactions between two dates, for previewing an import.",
    kind: "read",
    input: existingKeysInput,
    handler: ({ accountId, from, to }): Promise<string[]> =>
      asViewer(async (tx) => {
        const rows = await tx
          .select({ occurredOn: t.occurredOn, amountMinor: t.amountMinor, note: t.note })
          .from(t)
          .where(and(eq(t.accountId, accountId), gte(t.occurredOn, from), lte(t.occurredOn, to)))
        return rows.map(dedupeKey)
      }),
  }),

  importTransactions: defineAction({
    description:
      "Import transactions into one account. Rows already present (same date, signed amount and note, ignoring case and spacing) are skipped, counting repeats; a row with an importKey (its stable id in the source) is skipped instead when that key was imported before, so re-running an import never duplicates. categoryName is matched to an existing category by name (case-insensitive, the kind that fits the sign first); unknown names stay uncategorised. Returns the new ids (for undo) and how many were skipped.",
    kind: "write",
    input: importInput,
    handler: ({ accountId, rows }): Promise<{ ids: string[]; skipped: number }> =>
      asViewer(async (tx) => {
        const [account] = await tx.select({ id: a.id }).from(a).where(eq(a.id, accountId))
        if (!account) throw new BudgetInputError("Choose an account to import into.")

        // Keyed rows: new unless the key exists (anywhere in the budget) or repeats in this batch.
        const keys = [...new Set(rows.flatMap((x) => (x.importKey ? [x.importKey] : [])))]
        const knownKeys = new Set<string>()
        for (let i = 0; i < keys.length; i += 500) {
          const found = await tx
            .select({ key: t.importKey })
            .from(t)
            .where(inArray(t.importKey, keys.slice(i, i + 500)))
          for (const row of found) knownKeys.add(row.key!)
        }
        const keyed: typeof rows = []
        for (const row of rows) {
          if (!row.importKey || knownKeys.has(row.importKey)) continue
          knownKeys.add(row.importKey)
          keyed.push(row)
        }

        // Unkeyed rows: new unless the same date, amount and note is already there.
        const plain = rows.filter((x) => !x.importKey)
        let freshPlain: typeof plain = []
        if (plain.length) {
          const dates = plain.map((x) => x.occurredOn).sort()
          const existing = await tx
            .select({ occurredOn: t.occurredOn, amountMinor: t.amountMinor, note: t.note })
            .from(t)
            .where(and(eq(t.accountId, accountId), gte(t.occurredOn, dates[0]!), lte(t.occurredOn, dates.at(-1)!)))
          const duplicate = markDuplicates(plain, existing.map(dedupeKey))
          freshPlain = plain.filter((_, i) => !duplicate[i])
        }

        const fresh = [...keyed, ...freshPlain]
        if (fresh.length === 0) return { ids: [], skipped: rows.length }

        const categories = await tx.select({ id: c.id, name: c.name, kind: c.kind }).from(c)
        const categoryFor = (name: string | null, amountMinor: number) => {
          if (!name) return null
          const wanted = name.trim().toLowerCase()
          const kind = amountMinor < 0 ? "expense" : "income"
          const named = categories.filter((x) => x.name.toLowerCase() === wanted)
          return (named.find((x) => x.kind === kind) ?? named[0])?.id ?? null
        }
        const ids: string[] = []
        for (let i = 0; i < fresh.length; i += 500) {
          const inserted = await tx
            .insert(t)
            .values(
              fresh.slice(i, i + 500).map((row) => ({
                accountId,
                categoryId: categoryFor(row.categoryName, row.amountMinor),
                amountMinor: row.amountMinor,
                occurredOn: row.occurredOn,
                note: row.note.trim(),
                importKey: row.importKey ?? null,
                ...(row.recordedAt ? { createdAt: new Date(row.recordedAt) } : {}),
              })),
            )
            // A concurrent import of the same keys: the other one wins, nothing doubles.
            .onConflictDoNothing({ target: [t.ownerId, t.importKey] })
            .returning({ id: t.id })
          ids.push(...inserted.map((x) => x.id))
        }
        return { ids, skipped: rows.length - ids.length }
      }),
  }),
}
