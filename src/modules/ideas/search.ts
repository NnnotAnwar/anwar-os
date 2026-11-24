import "server-only"
import type { SearchProvider } from "@/core/module"
import { markdownToText } from "@/lib/markdown"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { ideaStatusLabels } from "./schema"

/** The viewer's own ideas by title, text or tag. */
export const search: SearchProvider = async (query, limit) => {
  const ideas = await actions.list.handler({ query, limit })
  return ideas.map((idea) => ({
    id: idea.id,
    title: idea.title,
    snippet: excerptAround(markdownToText(idea.body), query, 80) || undefined,
    meta: [ideaStatusLabels[idea.status], idea.isPublic ? "Public" : null, ...idea.tags.map((t) => `#${t}`)].filter((m) => m !== null),
    href: `/app/ideas/${idea.id}`,
  }))
}
