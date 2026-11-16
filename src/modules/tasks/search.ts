import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"

export const search: SearchProvider = async (query, limit) => {
  const tasks = await actions.search.handler({ query, limit })
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    snippet: [task.doneAt ? "Done" : task.dueDate ? `Due ${task.dueDate}` : "No date", task.notes.slice(0, 60)]
      .filter(Boolean)
      .join(" · "),
    href: `/app/tasks?task=${task.id}`,
  }))
}
