import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { domainOf } from "./schema"

export const search: SearchProvider = async (query, limit) => {
  const links = await actions.list.handler({ query, limit })
  return links.map((link) => ({
    id: link.id,
    title: link.title,
    snippet: [domainOf(link.url), ...link.tags.map((t) => `#${t}`)].join(" · "),
    href: `/app/links/${link.id}`,
  }))
}
