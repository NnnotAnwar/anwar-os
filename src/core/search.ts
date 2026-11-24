import "server-only"
import { z } from "zod"
import type { Viewer } from "@/core/auth"
import { modulesFor, type ModuleManifest, type SearchHit } from "@/core/module"
import { rankGroups, rankHits, SEARCH_LIMITS, SEARCH_MAX_QUERY, type SearchGroup, type SearchResponse } from "@/core/search-rank"
import { modules as registry } from "@/modules/_registry"

const queryInput = z.string().trim().min(1).max(SEARCH_MAX_QUERY)

/** A module slower than this is left out of the answer (and listed in `failed`). */
const PROVIDER_TIMEOUT_MS = 4000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** The modules the viewer may search, in registry (priority) order. */
export function searchableModules(role: Viewer["role"], modules: readonly ModuleManifest[] = registry) {
  return modulesFor(modules, role).filter((m) => m.search)
}

/**
 * Global search as `viewer`: asks each module they can use (or only `module`)
 * in parallel, each through its own RLS-scoped provider, and ranks the answer.
 * Callers must run it where getViewer() returns that same viewer (a request
 * with their session, or actAs()). One failing module never fails the rest.
 */
export async function runSearch(
  viewer: Pick<Viewer, "role">,
  raw: string,
  options: { module?: string | null; signal?: AbortSignal; modules?: readonly ModuleManifest[] } = {},
): Promise<SearchResponse> {
  const parsed = queryInput.safeParse(raw)
  const only = options.module || null
  if (!parsed.success) return { query: raw.trim(), module: only, groups: [], failed: [] }
  const query = parsed.data

  const mods = searchableModules(viewer.role, options.modules).filter((m) => !only || m.id === only)
  const limit = only ? SEARCH_LIMITS.module : SEARCH_LIMITS.overview
  // Providers order by their own idea of relevance (often recency), so the
  // overview asks for a few more candidates and keeps the best-ranked ones: an
  // old note titled exactly like the query still makes the top five. One more
  // than shown also tells us whether there is more.
  const candidates = only ? limit + 1 : SEARCH_LIMITS.candidates
  const failed: string[] = []

  const answers = await Promise.all(
    mods.map(async (m): Promise<SearchGroup | null> => {
      if (options.signal?.aborted) return null
      try {
        const provider = await m.search!()
        const hits: SearchHit[] = await withTimeout(provider(query, candidates), PROVIDER_TIMEOUT_MS)
        if (!hits.length) return null
        return { moduleId: m.id, moduleName: m.name, hits: rankHits(query, hits).slice(0, limit), more: hits.length > limit }
      } catch (error) {
        failed.push(m.id)
        console.error(`search: ${m.id} failed`, error)
        return null
      }
    }),
  )

  const groups = rankGroups(query, answers.filter((g) => g !== null))
  return { query, module: only, groups, failed }
}
