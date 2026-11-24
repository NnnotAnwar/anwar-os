import "server-only"
import type { SearchProvider } from "@/core/module"
import { markdownToText } from "@/lib/markdown"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { statusLabels } from "./schema"

/** The viewer's own projects by title, summary or case study. */
export const search: SearchProvider = async (query, limit) => {
  const projects = await actions.list.handler({ query, limit })
  return projects.map((project) => ({
    id: project.id,
    title: project.title,
    snippet: excerptAround(project.summary || markdownToText(project.body), query, 90) || undefined,
    meta: [statusLabels[project.status], project.isPublic ? "Public" : null, project.stack.slice(0, 3).join(", ") || null].filter(
      (m) => m !== null,
    ),
    href: `/app/projects/${project.id}`,
  }))
}
