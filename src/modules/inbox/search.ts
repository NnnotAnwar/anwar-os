import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { hostOf } from "./lib/extract"

export const search: SearchProvider = async (query, limit) => {
  const items = await actions.search.handler({ query, limit })
  return items.map((item) => ({
    id: item.id,
    title: item.text.split("\n")[0]?.slice(0, 120) || (item.url ? hostOf(item.url) : "Untitled"),
    snippet: ["In inbox", item.url ? hostOf(item.url) : null].filter(Boolean).join(" · "),
    href: `/app/inbox?item=${item.id}`,
  }))
}
