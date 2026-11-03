import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { excerpt } from "./schema"

export const search: SearchProvider = async (query, limit) => {
  const notes = await actions.list.handler({ query, limit })
  return notes.map((note) => ({
    id: note.id,
    title: note.title,
    snippet: excerpt(note.body, query, 80) || undefined,
    href: `/app/notes/${note.id}`,
  }))
}
