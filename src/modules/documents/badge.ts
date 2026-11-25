import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"
import { URGENT_DAYS } from "./lib/status"

/** Documents expired or expiring within 30 days; nothing otherwise. */
export const badge: BadgeLoader = async () => {
  const { documents } = await actions.upcoming.handler({ days: URGENT_DAYS, includeExpired: true })
  if (documents.length === 0) return null
  const expired = documents.filter((doc) => doc.status.tone === "expired").length
  return { count: documents.length, label: expired === documents.length ? "expired" : "expiring" }
}
