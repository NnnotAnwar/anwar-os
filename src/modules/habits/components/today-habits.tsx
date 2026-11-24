"use client"

import Link from "next/link"
import { NAV_FORWARD } from "@/components/motion"
import { cn } from "@/lib/utils"
import type { TodayHabit } from "../schema"
import { HabitCheck, StreakBadge, useHabitToggle } from "./habit-check"

/** The Today widget: today's habits, one tap to check each, the streak beside it. */
export function TodayHabitList({ habits }: { habits: TodayHabit[] }) {
  const { stateOf, toggle } = useHabitToggle()
  const done = habits.filter((habit) => stateOf(habit).done).length

  return (
    <div className="grid gap-1">
      <ul className="-mx-1 grid" aria-label="Today's habits">
        {habits.map((habit) => {
          const state = stateOf(habit)
          return (
            <li key={habit.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
              <HabitCheck checked={state.done} onToggle={() => toggle(habit)} label={`Done: ${habit.name}`} />
              <Link
                href={`/app/habits/${habit.id}`}
                transitionTypes={NAV_FORWARD}
                className={cn(
                  "text-body flex min-w-0 flex-1 items-baseline gap-1.5 rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
                  state.done && "text-muted-foreground",
                )}
              >
                {habit.emoji && <span aria-hidden>{habit.emoji}</span>}
                <span className="truncate">{habit.name}</span>
              </Link>
              <StreakBadge value={state.current} />
            </li>
          )
        })}
      </ul>
      <p className="text-caption px-1 text-muted-foreground tabular-nums" aria-live="polite">
        {done === habits.length ? "All done for today." : `${done} of ${habits.length} done`}
      </p>
    </div>
  )
}
