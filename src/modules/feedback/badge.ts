import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

/** New feedback plus contact messages still waiting for a reply. */
export const badge: BadgeLoader = async () => {
  const [feedback, contact] = await Promise.all([actions.counts.handler({}), actions.contactCounts.handler({})])
  const count = feedback.new + contact.new
  return count > 0 ? { count, label: "new" } : null
}
