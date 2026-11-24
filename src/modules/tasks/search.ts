import "server-only"
import type { SearchProvider } from "@/core/module"
import { searchDateFormat } from "@/core/search-context"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"

/** Tasks whose title or notes contain the query, open ones first; shows the list and due date. */
export const search: SearchProvider = async (query, limit) => {
  const [date, tasks] = await Promise.all([searchDateFormat(), actions.search.handler({ query, limit })])
  const lists = tasks.some((t) => t.listId) ? await actions.lists.handler({}) : []
  const listName = new Map(lists.map((l) => [l.id, l.name]))
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    snippet: excerptAround(task.notes, query, 80) || undefined,
    meta: [
      task.doneAt ? "Done" : task.dueDate ? `Due ${date(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ""}` : "No date",
      task.listId ? (listName.get(task.listId) ?? null) : null,
      task.priority === "high" && !task.doneAt ? "High priority" : null,
    ].filter((m) => m !== null),
    href: `/app/tasks?task=${task.id}`,
  }))
}
