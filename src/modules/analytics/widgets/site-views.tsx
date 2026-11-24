import Link from "next/link"
import { actions } from "../actions"
import { DailyBars } from "../components/charts"
import { change, pageLabel } from "../schema"

/** Today: views of the public site over the last seven days, against the week before. */
export async function SiteViews() {
  const stats = await actions.stats.handler({ days: 7 })
  const delta = change(stats.total, stats.previousTotal)
  const top = stats.pages[0]
  if (stats.total === 0 && stats.previousTotal === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        No views counted yet. Share a link to{" "}
        <Link href="/writing" className="text-text-accent underline-offset-4 hover:underline">
          your writing
        </Link>{" "}
        and they&apos;ll show up here.
      </p>
    )
  }
  return (
    <Link href="/app/analytics?range=7" className="press -m-2 grid gap-3 rounded-lg p-2 outline-none hover:bg-track/60 focus-visible:ring-3 focus-visible:ring-ring/50">
      <div className="flex items-baseline gap-2">
        <span className="text-metric tabular-nums">{stats.total.toLocaleString("en")}</span>
        <span className="text-meta text-muted-foreground">
          {stats.total === 1 ? "view" : "views"}
          {delta !== null && (
            <span className="tabular-nums">
              {" "}
              · {delta > 0 ? "+" : ""}
              {delta}% vs last week
            </span>
          )}
        </span>
      </div>
      <DailyBars daily={stats.daily} height="h-12" axis={false} />
      {top && (
        <p className="text-caption truncate text-muted-foreground">
          Most read: <span className="text-foreground">{pageLabel(top.key)}</span>
        </p>
      )}
    </Link>
  )
}
