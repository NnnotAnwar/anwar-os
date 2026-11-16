import { formatIsoDate, type LocalDate } from "./zoned"

export const views = ["month", "week", "agenda"] as const
export type View = (typeof views)[number]

/** /app/calendar?view=month&date=2026-11-16[&event=<id>|&new=1] */
export function calendarHref({
  view,
  date,
  event,
  create,
}: {
  view?: View
  date?: LocalDate
  event?: string
  create?: boolean
}) {
  const params = new URLSearchParams()
  if (view && view !== "month") params.set("view", view)
  if (date) params.set("date", formatIsoDate(date))
  if (event) params.set("event", event)
  if (create) params.set("new", "1")
  const qs = params.toString()
  return `/app/calendar${qs ? `?${qs}` : ""}`
}
