import "server-only"
import type { SearchProvider } from "@/core/module"
import { searchDateFormat } from "@/core/search-context"
import { actions } from "./actions"
import { excerpt } from "./schema"

/** Notes whose title or body contains the query; pinned first, then most recently edited. */
export const search: SearchProvider = async (query, limit) => {
  const [date, notes] = await Promise.all([searchDateFormat(), actions.list.handler({ query, limit })])
  return notes.map((note) => ({
    id: note.id,
    title: note.title || "Untitled",
    snippet: excerpt(note.body, query, 90) || undefined,
    meta: [note.pinned ? "Pinned" : null, `Edited ${date(note.updated_at)}`].filter((m) => m !== null),
    href: `/app/notes/${note.id}`,
  }))
}
