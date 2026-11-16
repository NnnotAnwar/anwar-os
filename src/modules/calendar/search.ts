import "server-only"
import { getViewer } from "@/core/auth"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { categoryInfo } from "./lib/categories"
import { formatDayMonth, formatTimeRange } from "./lib/format"
import { calendarHref } from "./lib/links"
import { wallClock, utcDate } from "./lib/zoned"

export const search: SearchProvider = async (query, limit) => {
  const [viewer, events] = await Promise.all([getViewer(), actions.search.handler({ query, limit })])
  const tz = viewer?.timezone ?? "Europe/Prague"
  const locale = viewer?.locale ?? "en"
  return events.map((e) => {
    const start = new Date(e.start)
    const zone = e.allDay ? "UTC" : tz
    const date = e.allDay ? utcDate(start) : wallClock(start, tz)
    const when = `${formatDayMonth(start, locale, zone, true)}${e.allDay ? "" : ` · ${formatTimeRange(start, new Date(e.end), tz)}`}`
    return {
      id: e.eventId,
      title: e.title,
      snippet: [when, categoryInfo[e.category].label, e.location].filter(Boolean).join(" · "),
      href: calendarHref({ view: "agenda", date, event: e.eventId }),
    }
  })
}
