import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

/** Today's scheduled habits not done yet. */
export const badge: BadgeLoader = async () => {
  const { habits } = await actions.today.handler({})
  const left = habits.filter((habit) => !habit.done).length
  if (left === 0) return null
  return { count: left, label: "left today" }
}
