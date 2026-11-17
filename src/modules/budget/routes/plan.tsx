import { Suspense } from "react"
import { Reveal, SkeletonExit } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { PlanChart, PlanForm } from "../components/plan"
import { formatMonth } from "../lib/dates"
import { formatMoney } from "../lib/money"
import type { ComparisonRow } from "../lib/projection"
import { BudgetPage, ensureSetup } from "./shell"

export default function PlanPage() {
  return (
    <BudgetPage
      title="Plan"
      description="Capital growth with monthly compounding, against your real net worth at each month's end."
    >
      <Suspense
        fallback={
          <SkeletonExit>
            <div className="grid gap-4" aria-hidden>
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-72 rounded-xl" />
            </div>
          </SkeletonExit>
        }
      >
        <Reveal>
          <Body />
        </Reveal>
      </Suspense>
    </BudgetPage>
  )
}

async function Body() {
  const viewer = await requireViewer()
  await ensureSetup()
  const { plan, rows, currentMonth } = await actions.getPlan.handler({})
  const locale = viewer.locale

  if (!plan) {
    return (
      <div className="grid gap-4">
        <div className="glass grid gap-1 rounded-xl p-4">
          <p className="text-card-title">Set your plan</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            How much you start with, how much you add each month and what return you expect. The chart then shows where
            that leads and where you actually are.
          </p>
        </div>
        <PlanForm plan={null} currentMonth={currentMonth} />
      </div>
    )
  }

  const known = rows.filter((r) => r.actualMinor !== null)
  const latest = known.at(-1)
  const end = rows.at(-1)!
  const money = (m: number, signed = false) => formatMoney(m, plan.currency, locale, { signed })
  // The table: each plan year's end plus every month that has actuals.
  const tableRows = rows.filter((r) => r.index % 12 === 0 || r.actualMinor !== null)

  return (
    <div className="grid gap-4">
      <dl className="glass grid grid-cols-2 gap-4 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:grid-cols-4">
        <Stat label={`In ${end.index / 12} years`} value={money(end.projectedMinor)} hint={`You put in ${money(end.contributedMinor)}`} />
        <Stat label="Growth" value={money(end.projectedMinor - end.contributedMinor)} hint={`${plan.annualReturnBp / 100} % a year`} />
        <Stat label="Now, planned" value={latest ? money(latest.projectedMinor) : "—"} hint={latest ? formatMonth(latest.month, locale) : "Plan hasn't started"} />
        <Stat
          label="Now, actual"
          value={latest ? money(latest.actualMinor!) : "—"}
          hint={latest ? `${money(latest.deltaMinor!, true)} vs plan` : undefined}
          tone={latest ? (latest.deltaMinor! >= 0 ? "ahead" : "behind") : undefined}
        />
      </dl>

      <PlanChart rows={rows} currency={plan.currency} locale={locale} />

      <details className="glass group rounded-xl">
        <summary className="text-body-strong flex min-h-11 cursor-pointer items-center px-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          Show as a table
        </summary>
        <div className="overflow-x-auto px-2 pb-3">
          <Table rows={tableRows} money={money} locale={locale} />
        </div>
      </details>

      <section aria-labelledby="plan-edit" className="grid gap-2">
        <h2 id="plan-edit" className="text-eyebrow px-1 text-text-accent">
          Plan settings
        </h2>
        <PlanForm plan={plan} currentMonth={currentMonth} />
      </section>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ahead" | "behind" }) {
  return (
    <div className="grid min-w-0 content-start gap-1">
      <dt className="text-eyebrow text-muted-foreground">{label}</dt>
      <dd className="text-metric truncate">{value}</dd>
      {hint && (
        <dd className={cn("text-caption tabular-nums text-muted-foreground", tone === "ahead" && "text-text-accent", tone === "behind" && "text-warning-text")}>
          {hint}
        </dd>
      )}
    </div>
  )
}

function Table({ rows, money, locale }: { rows: ComparisonRow[]; money: (m: number, signed?: boolean) => string; locale: string }) {
  return (
    <table className="text-meta w-full min-w-[32rem] tabular-nums">
      <thead>
        <tr className="text-caption text-left text-muted-foreground">
          <th scope="col" className="px-2 py-2 font-medium">
            Month end
          </th>
          <th scope="col" className="px-2 py-2 text-right font-medium">
            Put in
          </th>
          <th scope="col" className="px-2 py-2 text-right font-medium">
            Projected
          </th>
          <th scope="col" className="px-2 py-2 text-right font-medium">
            Actual
          </th>
          <th scope="col" className="px-2 py-2 text-right font-medium">
            Difference
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline">
        {rows.map((r) => (
          <tr key={r.index}>
            <th scope="row" className="px-2 py-1.5 text-left font-medium">
              {formatMonth(r.month, locale, "short")}
              {r.index > 0 && r.index % 12 === 0 && <span className="text-caption ml-1 text-muted-foreground">· year {r.index / 12}</span>}
            </th>
            <td className="px-2 py-1.5 text-right">{money(r.contributedMinor)}</td>
            <td className="px-2 py-1.5 text-right">{money(r.projectedMinor)}</td>
            <td className="px-2 py-1.5 text-right">{r.actualMinor === null ? "—" : money(r.actualMinor)}</td>
            <td className={cn("px-2 py-1.5 text-right", r.deltaMinor !== null && r.deltaMinor < 0 && "text-warning-text")}>
              {r.deltaMinor === null ? "—" : money(r.deltaMinor, true)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
