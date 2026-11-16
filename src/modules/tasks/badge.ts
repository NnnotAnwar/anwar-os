import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

/** Overdue plus due today: what still needs doing today. */
export const badge: BadgeLoader = async () => {
  const { overdue, today } = await actions.counts.handler({})
  const count = overdue + today
  if (count === 0) return null
  return { count, label: overdue > 0 ? `for today · ${overdue} late` : "for today" }
}
