import "server-only"
import { getViewer } from "@/core/auth"
import { shortDate } from "@/lib/search-text"

/** For search providers: formats result dates in the viewer's language and time zone. */
export async function searchDateFormat() {
  const viewer = await getViewer()
  const options = { locale: viewer?.locale ?? "en", timeZone: viewer?.timezone ?? "Europe/Prague" }
  return (day: string | Date) => shortDate(day, options)
}
