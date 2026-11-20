import { Suspense } from "react"
import { z } from "zod"
import { Reveal, SkeletonExit } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { TransactionFilters } from "../components/filters"
import { TransactionsBoard } from "../components/transactions-board"
import { monthOf, todayIn } from "../lib/dates"
import { formatMoney } from "../lib/money"
import { BudgetPage, ensureSetup, ListSkeleton, MonthSwitcher, monthParam, one } from "./shell"

type Props = PageProps<"/app/budget/transactions">

export default function TransactionsPage({ searchParams }: Props) {
  return (
    <BudgetPage title="Transactions" description="Everything in and out, by day. Tap a row to edit it.">
      <Suspense
        fallback={
          <SkeletonExit>
            <div className="grid gap-3" aria-hidden>
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-9 w-64" />
              <ListSkeleton rows={6} />
            </div>
          </SkeletonExit>
        }
      >
        <Reveal>
          <Body searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </BudgetPage>
  )
}

const uuid = (v: string | undefined) => (v && z.uuid().safeParse(v).success ? v : undefined)

async function Body({ searchParams }: Pick<Props, "searchParams">) {
  const params = await searchParams
  const viewer = await requireViewer()
  await ensureSetup()
  const today = todayIn(viewer.timezone)
  const current = monthOf(today)
  const month = monthParam(params.month, current)
  const accountId = uuid(one(params.account))
  const categoryParam = one(params.category)
  const categoryId = uuid(categoryParam)
  const query = one(params.q)?.slice(0, 100) || undefined

  const [transactions, accounts, categories] = await Promise.all([
    actions.listTransactions.handler({
      month,
      accountId,
      categoryId,
      uncategorized: categoryParam === "none" || undefined,
      query,
      limit: 2000,
    }),
    actions.listAccounts.handler({ includeArchived: true }),
    actions.listCategories.handler({ includeArchived: false }),
  ])

  // Month totals per currency, transfers left out.
  const totals = new Map<string, { in: number; out: number }>()
  for (const tx of transactions) {
    if (tx.transferId) continue
    const t = totals.get(tx.currency) ?? { in: 0, out: 0 }
    if (tx.amountMinor > 0) t.in += tx.amountMinor
    else t.out -= tx.amountMinor
    totals.set(tx.currency, t)
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthSwitcher
          month={month}
          current={current}
          locale={viewer.locale}
          basePath="/app/budget/transactions"
          params={{ account: accountId, category: categoryParam, q: query }}
        />
        <dl className="text-meta flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
          {[...totals.entries()].map(([currency, t]) => (
            <div key={currency} className="flex gap-3">
              <div className="flex gap-1">
                <dt className="text-muted-foreground">In</dt>
                <dd>{formatMoney(t.in, currency, viewer.locale)}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-muted-foreground">Out</dt>
                <dd>{formatMoney(t.out, currency, viewer.locale)}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
      <TransactionFilters accounts={accounts} categories={categories} />
      <TransactionsBoard
        key={`${month}|${accountId}|${categoryParam}|${query}`}
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        today={today}
        locale={viewer.locale}
        openNew={one(params.new) === "1"}
        editId={uuid(one(params.edit)) ?? null}
        defaultAccountId={accountId}
      />
    </div>
  )
}
