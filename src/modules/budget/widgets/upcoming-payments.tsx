import Link from "next/link"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { formatDay, todayIn } from "../lib/dates"
import { formatMoney } from "../lib/money"
import { relativeDay } from "../lib/subscriptions"

const SHOWN = 5

/** Today: recurring expenses charging in the next 7 days, soonest first. */
export async function UpcomingPayments({ ctx }: { ctx: { locale: string; timezone: string } }) {
  const payments = await actions.upcomingPayments.handler({ days: 7, subscriptionsOnly: false })
  if (payments.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        Nothing charges in the next 7 days.{" "}
        <Link href="/app/budget/subscriptions" className="text-text-accent underline-offset-4 hover:underline">
          Subscriptions
        </Link>
      </p>
    )
  }
  const today = todayIn(ctx.timezone)
  // Totals per currency, in the order they first appear.
  const totals = new Map<string, number>()
  for (const p of payments) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amountMinor)
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1.5">
        {payments.slice(0, SHOWN).map((p) => {
          const when = relativeDay(p.date, today) ?? formatDay(p.date, ctx.locale, today)
          const soon = p.date <= today || when === "Tomorrow"
          return (
            <li key={`${p.recurringId}:${p.date}`} className="flex items-baseline gap-2">
              <span className={cn("text-caption w-20 shrink-0 tabular-nums", soon ? "font-semibold text-warning-text" : "text-muted-foreground")}>
                {when}
              </span>
              <span className="text-body min-w-0 flex-1 truncate">{p.note}</span>
              <span className="text-body-strong tabular-nums">{formatMoney(p.amountMinor, p.currency, ctx.locale)}</span>
            </li>
          )
        })}
      </ul>
      <p className="text-caption text-muted-foreground tabular-nums">
        {payments.length > SHOWN && `+${payments.length - SHOWN} more · `}
        {[...totals].map(([currency, minor]) => formatMoney(minor, currency, ctx.locale)).join(" + ")} in the next 7 days ·{" "}
        <Link href="/app/budget/subscriptions" className="text-text-accent underline-offset-4 hover:underline">
          Subscriptions
        </Link>
      </p>
    </div>
  )
}
