import "server-only"
import type { SearchProvider } from "@/core/module"
import { searchDateFormat } from "@/core/search-context"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { hostOf } from "./lib/extract"

/** Unsorted inbox items whose text or link contains the query. */
export const search: SearchProvider = async (query, limit) => {
  const [date, items] = await Promise.all([searchDateFormat(), actions.search.handler({ query, limit })])
  return items.map((item) => {
    const [first = "", ...rest] = item.text.split("\n")
    return {
      id: item.id,
      title: first.slice(0, 120) || (item.url ? hostOf(item.url) : "Untitled"),
      snippet: excerptAround(rest.join(" "), query, 80) || undefined,
      meta: [`Captured ${date(item.createdAt)}`, item.url ? hostOf(item.url) : null].filter((m) => m !== null),
      href: `/app/inbox?item=${item.id}`,
    }
  })
}
