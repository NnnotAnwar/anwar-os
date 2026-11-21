import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

/** Services that need a look (unhealthy, crash-looping, down). Hidden when all is well or not connected. */
export const badge: BadgeLoader = async () => {
  const count = await actions.attentionCount.handler({})
  return count ? { count, label: count === 1 ? "needs attention" : "need attention" } : null
}
