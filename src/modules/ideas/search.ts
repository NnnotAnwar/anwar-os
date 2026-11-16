import "server-only"
import type { SearchProvider } from "@/core/module"
import { markdownToText } from "@/lib/markdown"
import { actions } from "./actions"
import { ideaStatusLabels } from "./schema"

export const search: SearchProvider = async (query, limit) => {
  const ideas = await actions.list.handler({ query, limit })
  return ideas.map((idea) => ({
    id: idea.id,
    title: idea.title,
    snippet: [ideaStatusLabels[idea.status], markdownToText(idea.body).slice(0, 70)].filter(Boolean).join(" · "),
    href: `/app/ideas/${idea.id}`,
  }))
}
