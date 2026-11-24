import "server-only"
import type { SearchProvider } from "@/core/module"
import { searchDateFormat } from "@/core/search-context"
import { excerptAround } from "@/lib/search-text"
import { actions } from "./actions"
import { contactStatusLabels, topicLabels } from "./contact/schema"
import { kindLabels, preview, statusLabels } from "./schema"

/**
 * Feedback sent to the viewer (not spam) by message, name or contact, and
 * contact messages (not archived) by name, email, company or message. Newest first.
 */
export const search: SearchProvider = async (query, limit) => {
  const [date, items, messages] = await Promise.all([
    searchDateFormat(),
    actions.list.handler({ filter: "inbox", query, limit }),
    actions.contactList.handler({ filter: "open", query, limit }),
  ])
  const snippet = (text: string) => {
    const around = excerptAround(text, query, 90)
    // The title already shows the start; repeat the message only when the match is further in.
    return around.startsWith("…") ? around : undefined
  }
  const feedback = items.map((item) => ({
    at: item.created_at,
    result: {
      id: item.id,
      title: preview(item.message, 70),
      snippet: snippet(item.message),
      meta: [kindLabels[item.kind], item.name || "Anonymous", statusLabels[item.status], date(item.created_at)],
      href: `/app/feedback/${item.id}`,
    },
  }))
  const contact = messages.map((m) => ({
    at: m.created_at,
    result: {
      id: m.id,
      title: `${m.name}${m.company ? ` · ${m.company}` : ""}: ${preview(m.message, 60)}`,
      snippet: snippet(m.message),
      meta: [topicLabels[m.topic], m.email, contactStatusLabels[m.status], date(m.created_at)],
      href: `/app/feedback/contact/${m.id}`,
    },
  }))
  return [...feedback, ...contact]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((r) => r.result)
}
