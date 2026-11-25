import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"
import { opsBadge } from "./lib/badge"

/**
 * Services that need a look (unhealthy, crash-looping, down) and unresolved
 * errors in the error log. Hidden when all is well (or not connected and no
 * errors).
 */
export const badge: BadgeLoader = async () => {
  const [services, errors] = await Promise.all([
    actions.attentionCount.handler({}).catch(() => null),
    actions.openErrorCount.handler({}).catch(() => 0),
  ])
  return opsBadge(services ?? 0, errors)
}
