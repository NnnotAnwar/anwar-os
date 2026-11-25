import "server-only"
import type { SearchProvider } from "@/core/module"
import { actions } from "./actions"
import { formatDayShort } from "./lib/format"
import { moodOf } from "./schema"

/** Journal lines that contain the query, newest first; opens that day on the Journal page. */
export const search: SearchProvider = async (query, limit) => {
  const entries = await actions.list.handler({ query, limit })
  return entries.map((entry) => {
    const mood = moodOf(entry.mood)
    return {
      id: entry.day,
      title: entry.text,
      meta: [formatDayShort(entry.day, undefined), entry.day.slice(0, 4), mood ? `${mood.emoji} ${mood.label}` : null].filter(
        (m) => m !== null,
      ),
      href: `/app/journal?day=${entry.day}`,
    }
  })
}
