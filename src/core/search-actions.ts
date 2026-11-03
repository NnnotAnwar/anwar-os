"use server"

import { z } from "zod"
import { getViewer } from "@/core/auth"
import { modulesFor, type SearchHit } from "@/core/module"
import { modules } from "@/modules/_registry"

export type SearchGroup = { moduleId: string; moduleName: string; hits: SearchHit[] }

const query = z.string().trim().min(1).max(100)

/** Global search for the command palette: asks every module the viewer can use. */
export async function searchEverything(raw: string): Promise<SearchGroup[]> {
  const parsed = query.safeParse(raw)
  if (!parsed.success) return []
  const viewer = await getViewer()
  if (!viewer) return []

  const groups = await Promise.all(
    modulesFor(modules, viewer.role).map(async (m) => {
      if (!("search" in m) || !m.search) return null
      const provider = await m.search()
      const hits = await provider(parsed.data, 6)
      return hits.length ? { moduleId: m.id, moduleName: m.name, hits } : null
    }),
  )
  return groups.filter((g) => g !== null)
}
