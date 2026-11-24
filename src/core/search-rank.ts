// Global search: the response shape shared by the route and the UI, and the
// ranking applied on top of each module's own order. Pure (client-safe).
import type { SearchHit } from "@/core/module"
import { matches } from "@/lib/search-text"

export type { SearchHit }

export type SearchGroup = {
  moduleId: string
  moduleName: string
  hits: SearchHit[]
  /** The module has more matches than were returned (filter by it to see them). */
  more: boolean
}

export type SearchResponse = {
  query: string
  /** The module the search was narrowed to, if any. */
  module: string | null
  groups: SearchGroup[]
  /** Modules that failed or timed out; the rest still answered. */
  failed: string[]
}

/**
 * Hits per module: a few in the overview (picked from `candidates`, ranked),
 * many when narrowed to one module.
 */
export const SEARCH_LIMITS = { overview: 5, candidates: 15, module: 30 } as const
export const SEARCH_MAX_QUERY = 100

const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase()
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * How well a hit matches, from what the UI shows: an exact title beats a title
 * that starts with the query, then a word in the title, anywhere in the title,
 * the snippet or metadata, and last a match only in text we don't show (a body).
 */
export function scoreHit(query: string, hit: SearchHit): number {
  const q = fold(query)
  if (!q) return 0
  const title = fold(hit.title)
  if (title === q) return 100
  if (title.startsWith(q)) return 80
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(q)}`, "u").test(title)) return 65
  if (title.includes(q)) return 50
  if (matches(title, q)) return 40
  if (matches(hit.aside, q)) return 35
  if (matches(hit.snippet, q) || hit.meta?.some((m) => matches(m, q))) return 25
  return 10
}

/** Hits best first; equal scores keep the module's own order (usually most recent first). */
export function rankHits(query: string, hits: SearchHit[]): SearchHit[] {
  return hits
    .map((hit, i) => ({ hit, i, score: scoreHit(query, hit) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.hit)
}

/** Groups whose best hit is strongest first; ties keep the registry's priority order. */
export function rankGroups<G extends { hits: SearchHit[] }>(query: string, groups: G[]): G[] {
  return groups
    .map((group, i) => ({ group, i, top: Math.max(0, ...group.hits.map((h) => scoreHit(query, h))) }))
    .sort((a, b) => b.top - a.top || a.i - b.i)
    .map((x) => x.group)
}
