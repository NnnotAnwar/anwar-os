import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { kindLabels, preview } from "./schema"

export const search: SearchProvider = async (query, limit) => {
  const items = await actions.list.handler({ filter: "inbox", query, limit })
  return items.map((item) => ({
    id: item.id,
    title: preview(item.message, 70),
    snippet: `${kindLabels[item.kind]} · ${item.name || "Anonymous"}`,
    href: `/app/feedback/${item.id}`,
  }))
}
