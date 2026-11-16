import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

export const badge: BadgeLoader = async () => {
  const count = await actions.count.handler({})
  return count > 0 ? { count, label: "to process" } : null
}
