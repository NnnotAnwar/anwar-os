import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { kindLabels } from "./schema"

/** Documents whose name (or kind, "visa") contains the query, with their status. */
export const search: SearchProvider = async (query, limit) => {
  const { documents } = await actions.list.handler({ query, limit })
  return documents.map((doc) => ({
    id: doc.id,
    title: doc.name,
    meta: [kindLabels[doc.kind], doc.status.detail],
    href: `/app/documents/${doc.id}`,
  }))
}
