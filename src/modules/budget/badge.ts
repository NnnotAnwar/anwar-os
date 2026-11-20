import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

/** Recurring payments waiting for "Generate due". */
export const badge: BadgeLoader = async () => {
  const due = await actions.dueCount.handler({})
  return due > 0 ? { count: due, label: due === 1 ? "payment due" : "payments due" } : null
}
