import "server-only"
import Link from "next/link"
import { hasModule } from "@/core/module-actions"
import type { CalendarDate } from "@/lib/time"
import { goalsForToday } from "../actions"
import { pace, paceLabels, percent, yearElapsed } from "../lib/progress"
import { ProgressBar } from "./goal-progress"

/**
 * Today, under the year ruler: this year's goals as thin bars, each with a tick
 * where the year is now, so "behind" is visible at a glance. Nothing at all
 * while the year has no goals.
 */
export async function TodayGoals({ today }: { today: CalendarDate }) {
  if (!(await hasModule("goals"))) return null
  const goals = await goalsForToday(today.year)
  if (goals.length === 0) return null
  const elapsed = yearElapsed(today)

  return (
    <section aria-labelledby="today-goals" className="grid gap-2 border-t border-hairline pt-4">
      <div className="flex items-center justify-between">
        <h2 id="today-goals" className="text-eyebrow text-text-accent">
          Goals for {today.year}
        </h2>
        <Link
          href="/app/goals"
          className="text-caption -my-3 rounded py-3 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          All goals
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 md:grid-cols-2">
        {goals.map((goal) => {
          const pct = percent(goal.progress)
          const p = pace(goal.progress, goal.status, elapsed)
          return (
            <li key={goal.id}>
              <Link
                href={`/app/goals/${goal.id}`}
                className="press -mx-2 grid min-h-11 grid-cols-1 content-center gap-1.5 rounded-lg px-2 py-1.5 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-body min-w-0 flex-1 truncate">{goal.title}</span>
                  <span className="text-caption shrink-0 text-muted-foreground tabular-nums">
                    {goal.status === "done" ? "Achieved" : pct === null ? "—" : `${pct}%`}
                    {p === "behind" && <span className="text-warning-text"> · {paceLabels[p]}</span>}
                  </span>
                </span>
                <ProgressBar goal={goal} elapsed={elapsed} className="h-1" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
