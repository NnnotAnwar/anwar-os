import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { describeSchedule } from "./lib/days"

/** Habits whose name contains the query; shows the schedule, archived ones marked. */
export const search: SearchProvider = async (query, limit) => {
  const habits = await actions.search.handler({ query, limit })
  return habits.map((habit) => ({
    id: habit.id,
    title: habit.emoji ? `${habit.emoji} ${habit.name}` : habit.name,
    meta: [describeSchedule(habit.weekdays), habit.reminderTime ? `Reminder ${habit.reminderTime}` : null, habit.archived ? "Archived" : null].filter(
      (m) => m !== null,
    ),
    href: `/app/habits/${habit.id}`,
  }))
}
