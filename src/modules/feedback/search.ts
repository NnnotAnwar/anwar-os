import "server-only"
import type { SearchProvider } from "@/core/module"
import { searchDateFormat } from "@/core/search-context"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { kindLabels, preview, statusLabels } from "./schema"

/** Feedback sent to the viewer (not spam) by message, name or contact. */
export const search: SearchProvider = async (query, limit) => {
  const [date, items] = await Promise.all([searchDateFormat(), actions.list.handler({ filter: "inbox", query, limit })])
  return items.map((item) => {
    const around = excerptAround(item.message, query, 90)
    return {
      id: item.id,
      title: preview(item.message, 70),
      // The title already shows the start; repeat the message only when the match is further in.
      snippet: around.startsWith("…") ? around : undefined,
      meta: [kindLabels[item.kind], item.name || "Anonymous", statusLabels[item.status], date(item.created_at)],
      href: `/app/feedback/${item.id}`,
    }
  })
}
