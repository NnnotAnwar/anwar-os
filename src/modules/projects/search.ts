import "server-only"
import type { SearchProvider } from "@/core/module"
import { markdownToText } from "@/lib/markdown"
import { actions } from "./actions"

export const search: SearchProvider = async (query, limit) => {
  const projects = await actions.list.handler({ query, limit })
  return projects.map((project) => ({
    id: project.id,
    title: project.title,
    snippet: (project.summary || markdownToText(project.body)).slice(0, 90) || undefined,
    href: `/app/projects/${project.id}`,
  }))
}
