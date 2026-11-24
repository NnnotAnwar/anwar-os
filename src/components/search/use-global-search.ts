"use client"

import { useCallback, useEffect, useState } from "react"
import type { SearchResponse } from "@/core/search-rank"

/** Typing pauses this long before a request goes out. */
export const SEARCH_DEBOUNCE_MS = 160
const CACHE_TTL_MS = 30_000
const CACHE_MAX = 40

// Answers for this tab, so backspacing or re-picking a filter is instant.
// Cleared whenever search opens, so edits made since then show up.
const cache = new Map<string, { at: number; data: SearchResponse }>()
// Part of every request key: after clearSearchCache() the same query is a new
// request, so it's fetched again instead of waiting on a cache entry that's gone.
let generation = 0

function readCache(key: string) {
  const hit = cache.get(key)
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.data : null
}

function writeCache(key: string, data: SearchResponse) {
  cache.set(key, { at: Date.now(), data })
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
}

export function clearSearchCache() {
  cache.clear()
  generation++
}

type Settled = { key: string; data: SearchResponse | null; error: boolean }

/**
 * Global search state for the palette and the phone sheet: the query, an
 * optional module filter, and the answer. Requests are debounced, and a newer
 * query aborts the request still in flight, so a slow answer never replaces a
 * newer one. While the next answer loads the previous one stays on screen.
 */
export function useGlobalSearch() {
  const [query, setQuery] = useState("")
  const [module, setModule] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled>({ key: "", data: null, error: false })
  // The last overview (all modules) answer: its counts label the filter chips.
  const [overview, setOverview] = useState<SearchResponse | null>(null)

  const q = query.trim().replace(/\s+/g, " ")
  const key = q ? `${module ?? "*"}|${q.toLocaleLowerCase()}|${generation}.${attempt}` : ""
  const cached = key ? readCache(key) : null

  useEffect(() => {
    if (!key || readCache(key)) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (module) params.set("m", module)
        const response = await fetch(`/api/search?${params}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        })
        if (!response.ok) throw new Error(`search answered ${response.status}`)
        const data = (await response.json()) as SearchResponse
        writeCache(key, data)
        setSettled({ key, data, error: false })
        if (!data.module) setOverview(data)
      } catch {
        if (!controller.signal.aborted) setSettled({ key, data: null, error: true })
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, q, module])

  const current = cached ?? (settled.key === key ? settled.data : null)
  const loading = Boolean(key) && !current && !(settled.key === key && settled.error)
  const error = Boolean(key) && settled.key === key && settled.error
  // Previous answer stays visible (dimmed) while the next one loads.
  const data = current ?? (loading ? settled.data : null)
  const overviewForQuery = overview && overview.query.toLocaleLowerCase() === q.toLocaleLowerCase() ? overview : null

  const retry = useCallback(() => {
    clearSearchCache()
    setAttempt((n) => n + 1)
  }, [])

  const reset = useCallback(() => {
    clearSearchCache()
    setQuery("")
    setModule(null)
  }, [])

  return {
    query,
    setQuery,
    /** The trimmed query the answer is for. */
    q,
    module,
    setModule,
    data: q ? data : null,
    stale: Boolean(q) && !current && Boolean(data),
    loading,
    error,
    /** Counts per module from the overview answer for the same query, if any. */
    overview: overviewForQuery ?? (current && !current.module ? current : null),
    retry,
    reset,
  }
}
