import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { itemHref } from "./lib/links"
import { formatBytes } from "./lib/validation"

export const search: SearchProvider = async (query, limit) => {
  const results = await actions.search.handler({ query, limit })
  return results.map((r) => {
    const where = r.folderName ? `in ${r.folderName}` : "at the top level"
    const snippet =
      r.kind === "folder"
        ? `Folder ${where}`
        : r.kind === "document"
          ? r.excerpt || `Document ${where}`
          : [formatBytes(r.size), r.description || where].join(" · ")
    return { id: `${r.kind}:${r.id}`, title: r.name, snippet, href: itemHref(r) }
  })
}
