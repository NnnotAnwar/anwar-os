import Link from "next/link"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { Bar, CategoryDot } from "../components/bits"
import { limitBarClass } from "../lib/limits"
import { formatMoney } from "../lib/money"

const SHOWN = 4

/** Today: this month's category limits, the fullest first. */
export async function BudgetLimits({ ctx }: { ctx: { locale: string } }) {
  const data = await actions.limits.handler({})
  if (data.items.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        No limits set.{" "}
        <Link href="/app/budget/limits" className="text-text-accent underline-offset-4 hover:underline">
          Set one for a category
        </Link>
      </p>
    )
  }
  const money = (minor: number) => formatMoney(minor, data.baseCurrency, ctx.locale)
  return (
    <div className="grid gap-2.5">
      <ul className="grid gap-2.5">
        {data.items.slice(0, SHOWN).map((limit) => (
          <li key={limit.categoryId} className="grid gap-1">
            <span className="flex items-baseline gap-2">
              <CategoryDot color={limit.color} className="self-center" />
              <span className="text-body min-w-0 flex-1 truncate">{limit.name}</span>
              <span
                className={cn(
                  "text-caption tabular-nums",
                  limit.status === "over" ? "font-semibold text-destructive" : limit.status === "near" ? "font-semibold text-warning-text" : "text-muted-foreground",
                )}
              >
                {limit.leftMinor >= 0 ? `${money(limit.leftMinor)} left` : `over by ${money(-limit.leftMinor)}`}
              </span>
            </span>
            <Bar value={limit.spentMinor / limit.limitMinor} className={limitBarClass(limit.status)} />
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground tabular-nums">
        {data.items.length > SHOWN && `+${data.items.length - SHOWN} more · `}
        <Link href="/app/budget/limits" className="text-text-accent underline-offset-4 hover:underline">
          All limits
        </Link>
      </p>
    </div>
  )
}
