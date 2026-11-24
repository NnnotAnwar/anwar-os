import "server-only"
import type { SearchProvider } from "@/core/module"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { domainOf } from "./schema"

/** The viewer's own links (never the site owner's published ones) by title, URL, description, note or tag. */
export const search: SearchProvider = async (query, limit) => {
  const links = await actions.list.handler({ query, limit })
  return links.map((link) => ({
    id: link.id,
    title: link.title,
    snippet: excerptAround(link.note || link.description, query, 80) || undefined,
    meta: [domainOf(link.url), link.is_public ? "Public" : null, ...link.tags.map((t) => `#${t}`)].filter((m) => m !== null),
    href: `/app/links/${link.id}`,
  }))
}
