import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

export const badge: BadgeLoader = async () => {
  const counts = await actions.counts.handler({})
  return counts.new > 0 ? { count: counts.new, label: "new" } : null
}
