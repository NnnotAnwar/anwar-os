import "server-only"
import type { BadgeLoader } from "@/core/module"
import { actions } from "./actions"

export const badge: BadgeLoader = async () => {
  const counts = await actions.counts.handler({})
  const active = (counts.exploring ?? 0) + (counts.building ?? 0)
  return active > 0 ? { count: active, label: "in progress" } : null
}
