import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

/** Bots that stopped sending heartbeats. */
export const badge: BadgeLoader = async () => {
  const count = await actions.silentCount.handler({})
  return count > 0 ? { count, label: "silent" } : null
}
