import "server-only"
import { cache } from "react"
import { eq } from "drizzle-orm"
import { asViewer, requireViewer } from "@/core/auth"
import { modulesFor, type ModuleManifest } from "@/core/module"
import { corePreferences } from "@/db/schema"
import { modules } from "@/modules/_registry"

/** Without a saved choice, the first modules in registry (priority) order. */
const DEFAULT_PINNED = 4

export type Service = ModuleManifest

/** The modules this viewer can use, and which of them they pinned (in order). */
export const getServices = cache(async () => {
  const viewer = await requireViewer()
  const all = modulesFor(modules, viewer.role) as Service[]
  const ids = new Set(all.map((m) => m.id))

  const [row] = await asViewer((tx) =>
    tx
      .select({ pinned: corePreferences.pinnedServices })
      .from(corePreferences)
      .where(eq(corePreferences.ownerId, viewer.id)),
  )
  const saved = row?.pinned.filter((id) => ids.has(id))
  const pinnedIds = saved ?? all.slice(0, DEFAULT_PINNED).map((m) => m.id)

  const byId = new Map(all.map((m) => [m.id, m]))
  const pinned = pinnedIds.map((id) => byId.get(id)!).filter(Boolean)
  const rest = all.filter((m) => !pinnedIds.includes(m.id))
  return { all, pinned, rest, pinnedIds, isDefault: !row }
})

/** Card badges for the given modules. A failing loader hides its badge, never the page. */
export async function loadBadges(services: Service[]) {
  const entries = await Promise.all(
    services.map(async (m) => {
      if (!m.badge) return [m.id, null] as const
      try {
        const loader = await m.badge()
        return [m.id, await loader()] as const
      } catch {
        return [m.id, null] as const
      }
    }),
  )
  return Object.fromEntries(entries) as Record<string, { count: number; label: string } | null>
}
