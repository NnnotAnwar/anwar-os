import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

/** "3 active" for this year; nothing once every goal is settled. */
export const badge: BadgeLoader = async () => {
  const goals = await actions.list.handler({ status: ["active"], limit: 100 })
  return goals.length > 0 ? { count: goals.length, label: "active" } : null
}
