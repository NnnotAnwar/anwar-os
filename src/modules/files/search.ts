import "server-only"
import type { SearchHit, SearchProvider } from "@/core/module"
import { searchDateFormat } from "@/core/search-context"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { itemHref } from "./lib/links"
import { formatBytes } from "./lib/validation"

/** Folders, files (name, description, tags) and documents (title, text). */
export const search: SearchProvider = async (query, limit) => {
  const [date, results] = await Promise.all([searchDateFormat(), actions.search.handler({ query, limit })])
  return results.map((r): SearchHit => {
    const where = r.folderName ? `In ${r.folderName}` : "Top level"
    switch (r.kind) {
      case "folder":
        return { id: `folder:${r.id}`, title: r.name, meta: ["Folder", where], href: itemHref(r) }
      case "document":
        return {
          id: `document:${r.id}`,
          title: r.name,
          snippet: excerptAround(r.excerpt, query, 90) || undefined,
          meta: ["Document", where, `Edited ${date(r.updatedAt)}`],
          href: itemHref(r),
        }
      case "file":
        return {
          id: `file:${r.id}`,
          title: r.name,
          snippet: excerptAround(r.description, query, 80) || undefined,
          meta: [formatBytes(r.size), where, ...r.tags.map((t) => `#${t}`)],
          href: itemHref(r),
        }
    }
  })
}
