import "server-only"
import { getViewer } from "@/core/auth"
import type { SearchProvider } from "@/core/module"
import { excerptAround, shortDate } from "@/lib/search-text"
import { actions } from "./actions"
import { categoryInfo } from "./lib/categories"
import { formatTimeRange } from "./lib/format"
import { calendarHref } from "./lib/links"
import { wallClock, utcDate } from "./lib/zoned"

/** Events whose title, location or notes match, each with its next (or last) occurrence. */
export const search: SearchProvider = async (query, limit) => {
  const [viewer, events] = await Promise.all([getViewer(), actions.search.handler({ query, limit })])
  const tz = viewer?.timezone ?? "Europe/Prague"
  const locale = viewer?.locale ?? "en"
  return events.map((e) => {
    const start = new Date(e.start)
    // All-day events are stored at UTC midnight: read their day in UTC.
    const zone = e.allDay ? "UTC" : tz
    const date = e.allDay ? utcDate(start) : wallClock(start, tz)
    return {
      id: e.eventId,
      title: e.title,
      snippet: excerptAround(e.notes, query, 80) || undefined,
      meta: [
        shortDate(start, { locale, timeZone: zone }),
        e.allDay ? "All day" : formatTimeRange(start, new Date(e.end), tz),
        categoryInfo[e.category].label,
        e.location || null,
      ].filter((m) => m !== null),
      href: calendarHref({ view: "agenda", date, event: e.eventId }),
    }
  })
}
