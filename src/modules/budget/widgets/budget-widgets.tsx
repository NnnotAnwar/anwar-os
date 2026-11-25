import Link from "next/link"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { Bar } from "../components/bits"
import { approx } from "../components/fx-note"
import { formatMoney } from "../lib/money"

/** Today: this month's spending against income, in the base currency. */
export async function ThisMonth({ ctx }: { ctx: { locale: string } }) {
  const o = await actions.overview.handler({})
  if (o.transactionCount === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        Nothing recorded this month.{" "}
        <Link href="/app/budget/transactions?new=1" className="text-text-accent underline-offset-4 hover:underline">
          Add a transaction
        </Link>
      </p>
    )
  }
  const money = (m: number, signed = false) => approx(o.fx) + formatMoney(m, o.baseCurrency, ctx.locale, { signed })
  const over = o.expenseMinor > o.incomeMinor
  const top = o.spending[0]
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-3 gap-3">
        <div className="grid gap-0.5">
          <dt className="text-eyebrow text-muted-foreground">Spent</dt>
          <dd className="text-metric">{money(o.expenseMinor)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-eyebrow text-muted-foreground">Income</dt>
          <dd className="text-metric">{money(o.incomeMinor)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-eyebrow text-muted-foreground">Net</dt>
          <dd className={cn("text-metric", o.netMinor > 0 && "text-text-accent")}>{money(o.netMinor, true)}</dd>
        </div>
      </dl>
      {o.incomeMinor > 0 && <Bar value={o.expenseMinor / o.incomeMinor} className={over ? "bg-destructive" : undefined} />}
      <p className="text-caption text-muted-foreground tabular-nums">
        {o.incomeMinor > 0
          ? `${Math.round((o.expenseMinor / o.incomeMinor) * 100)} % of income spent${o.savingsRate !== null && !over ? ` · ${o.savingsRate} % saved` : ""}`
          : "No income recorded yet"}
        {top && ` · most on ${top.name}`}
      </p>
    </div>
  )
}
