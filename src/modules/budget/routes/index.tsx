import { Suspense } from "react"
import Link from "next/link"
import { ArrowUpRight, Bank, PiggyBank, TrendingUp, Wallet } from "@/components/icons"
import { NAV_FORWARD, Reveal, SkeletonExit } from "@/components/motion"
import { PendingItems } from "@/components/offline/pending-items"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { Bar, CategoryDot } from "../components/bits"
import { approxMoney, FxNoteLine, leftOutText } from "../components/fx-note"
import { GenerateDueButton } from "../components/generate-due"
import { OverviewQuickAdd } from "../components/overview-quick-add"
import { formatMonth, monthOf, todayIn } from "../lib/dates"
import { ratesLabel } from "../fx/convert"
import { formatMoney } from "../lib/money"
import { accountKindLabels, type AccountKind, type Overview } from "../schema"
import { BudgetPage, ensureSetup, MonthSwitcher, monthParam } from "./shell"

type Props = PageProps<"/app/budget">

export default function BudgetOverviewPage({ searchParams }: Props) {
  return (
    <BudgetPage title="Overview" description="This month at a glance: what came in, what went out, where it went.">
      <PendingItems kinds={["expense"]} />
      <Suspense fallback={<OverviewSkeleton />}>
        <Reveal>
          <Body searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </BudgetPage>
  )
}

const kindIcon: Record<AccountKind, typeof Bank> = { cash: Wallet, bank: Bank, savings: PiggyBank, investment: TrendingUp }

async function Body({ searchParams }: Pick<Props, "searchParams">) {
  const params = await searchParams
  const viewer = await requireViewer()
  await ensureSetup()
  const today = todayIn(viewer.timezone)
  const current = monthOf(today)
  const month = monthParam(params.month, current)
  const [overview, due] = await Promise.all([actions.overview.handler({ month }), actions.dueCount.handler({})])
  const locale = viewer.locale
  const money = (minor: number, opts?: { signed?: boolean }) => approxMoney(minor, overview.baseCurrency, locale, overview.fx, opts)

  return (
    <div className="grid gap-4">
      <MonthSwitcher month={month} current={current} locale={locale} basePath="/app/budget" />

      <section aria-labelledby="totals" className="glass grid gap-4 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-5">
        <h2 id="totals" className="sr-only">
          Totals for {formatMonth(month, locale)}
        </h2>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label="Income" value={money(overview.incomeMinor)} />
          <Metric label="Spent" value={money(overview.expenseMinor)} />
          <Metric label="Net" value={money(overview.netMinor, { signed: true })} accent={overview.netMinor > 0} />
          <Metric
            label="Savings rate"
            value={overview.savingsRate === null ? "—" : `${overview.savingsRate} %`}
            hint={overview.savingsRate === null ? "No income yet" : "Of income kept"}
          />
        </dl>
        {overview.incomeMinor > 0 && (
          <div className="grid gap-1.5">
            <Bar value={overview.expenseMinor / overview.incomeMinor} className={overview.expenseMinor > overview.incomeMinor ? "bg-destructive" : undefined} />
            <p className="text-caption text-muted-foreground tabular-nums">
              {Math.round((overview.expenseMinor / overview.incomeMinor) * 100)} % of income spent
              {overview.expenseMinor > overview.incomeMinor && " — more than came in"}
            </p>
          </div>
        )}
        <FxNoteLine note={overview.fx} today={overview.today} locale={locale} unavailableText={null} />
        {overview.otherCurrencies.length > 0 && (
          <p className="text-caption text-muted-foreground tabular-nums">{leftOutText(overview.otherCurrencies, locale)}</p>
        )}
      </section>

      {month === current && <OverviewQuickAdd accounts={overview.accounts} locale={locale} />}

      {due > 0 && (
        <section className="glass flex flex-wrap items-center gap-3 rounded-xl p-4" aria-labelledby="due-title">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h2 id="due-title" className="text-body-strong">
              {due === 1 ? "A recurring payment is due" : `${due} recurring payments are due`}
            </h2>
            <p className="text-caption text-muted-foreground">They become transactions when you generate them. Running it twice adds nothing.</p>
          </div>
          <GenerateDueButton count={due} />
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <SpendingCard overview={overview} locale={locale} month={month} />
        <div className="grid content-start gap-4">
          <AccountsCard overview={overview} locale={locale} />
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="grid min-w-0 content-start gap-1">
      <dt className="text-eyebrow text-muted-foreground">{label}</dt>
      <dd className={cn("text-metric truncate", accent && "text-text-accent")}>{value}</dd>
      {hint && <dd className="text-caption text-muted-foreground">{hint}</dd>}
    </div>
  )
}

function SpendingCard({ overview, locale, month }: { overview: Overview; locale: string; month: string }) {
  const max = Math.max(1, ...overview.spending.map((s) => s.amountMinor))
  const total = overview.expenseMinor || 1
  return (
    <section aria-labelledby="spending-title" className="glass grid content-start gap-3 rounded-xl p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 id="spending-title" className="text-card-title">
          Spending by category
        </h2>
        <Link
          href={`/app/budget/transactions${month === monthOf(overview.today) ? "" : `?month=${month}`}`}
          transitionTypes={NAV_FORWARD}
          className="text-caption flex items-center gap-0.5 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          All transactions
          <ArrowUpRight className="size-3" />
        </Link>
      </header>
      {overview.spending.length === 0 ? (
        <p className="text-meta text-muted-foreground">No spending recorded for this month yet.</p>
      ) : (
        <ul className="grid gap-1">
          {overview.spending.map((s) => {
            const q = new URLSearchParams()
            if (month !== monthOf(overview.today)) q.set("month", month)
            q.set("category", s.id ?? "none")
            return (
              <li key={s.id ?? "none"}>
                <Link
                  href={`/app/budget/transactions?${q}`}
                  transitionTypes={NAV_FORWARD}
                  className="press -mx-2 grid gap-1.5 rounded-lg px-2 py-2 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex items-center gap-2">
                    <CategoryDot color={s.color} />
                    <span className="text-body min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-caption text-muted-foreground tabular-nums">{Math.round((s.amountMinor / total) * 100)} %</span>
                    <span className="text-body-strong w-28 text-right tabular-nums">{formatMoney(s.amountMinor, overview.baseCurrency, locale)}</span>
                  </span>
                  <Bar value={s.amountMinor / max} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function AccountsCard({ overview, locale }: { overview: Overview; locale: string }) {
  // The total in the base currency (other currencies at the latest rate); what has no rate stays apart.
  const base = overview.baseCurrency
  let total = 0
  let converted = false
  const apart = new Map<string, number>()
  for (const a of overview.accounts) {
    if (a.currency === base) total += a.balanceMinor
    else if (a.baseBalance) {
      total += a.baseBalance.minor
      converted = true
    } else apart.set(a.currency, (apart.get(a.currency) ?? 0) + a.balanceMinor)
  }
  const rateOn = overview.accounts.reduce<string | null>((d, a) => (a.baseBalance && (!d || a.baseBalance.rateOn > d) ? a.baseBalance.rateOn : d), null)
  const approximate = overview.accounts.some((a) => a.baseBalance?.approximate)
  return (
    <section aria-labelledby="accounts-title" className="glass grid content-start gap-3 rounded-xl p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 id="accounts-title" className="text-card-title">
          Balances
        </h2>
        <Link
          href="/app/budget/accounts"
          transitionTypes={NAV_FORWARD}
          className="text-caption flex items-center gap-0.5 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Accounts
          <ArrowUpRight className="size-3" />
        </Link>
      </header>
      <ul className="grid gap-0.5">
        {overview.accounts.map((a) => {
          const Icon = kindIcon[a.kind]
          return (
            <li key={a.id}>
              <Link
                href={`/app/budget/transactions?account=${a.id}`}
                transitionTypes={NAV_FORWARD}
                className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={accountKindLabels[a.kind]} />
                <span className="text-body min-w-0 flex-1 truncate">{a.name}</span>
                <span className="grid justify-items-end">
                  <span className={cn("text-body-strong tabular-nums", a.balanceMinor < 0 && "text-destructive")}>
                    {formatMoney(a.balanceMinor, a.currency, locale)}
                  </span>
                  {a.baseBalance && (
                    <span className="text-caption text-muted-foreground tabular-nums">≈ {formatMoney(a.baseBalance.minor, a.baseBalance.currency, locale)}</span>
                  )}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {overview.accounts.length > 0 && (
        <div className="grid gap-1 border-t border-hairline pt-2">
          <p className="text-meta flex flex-wrap justify-between gap-2 tabular-nums">
            <span className="text-muted-foreground">Total</span>
            <span className="text-body-strong">
              {[`${converted ? "≈ " : ""}${formatMoney(total, base, locale)}`, ...[...apart].map(([c, v]) => formatMoney(v, c, locale))].join(" · ")}
            </span>
          </p>
          {(rateOn || apart.size > 0) && (
            <p className="text-caption text-right text-muted-foreground">
              {[
                rateOn && ratesLabel({ source: "ČNB", rateOn, approximate, converted: [], unavailable: [] }, overview.today, locale),
                apart.size > 0 && `${[...apart.keys()].join(", ")} not converted (no rate)`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function OverviewSkeleton() {
  return (
    <SkeletonExit>
      <div className="grid gap-4" aria-hidden>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    </SkeletonExit>
  )
}
