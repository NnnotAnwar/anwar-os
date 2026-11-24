// Display helpers for ISO days ("2026-11-24"), formatted at UTC so the day never shifts.

const at = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** "Tuesday 24 Nov". */
export function formatDayLabel(iso: string, locale = "en") {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(at(iso))
}

/** "November 2026". */
export function formatMonthLabel(month: string, locale = "en") {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(at(`${month}-01`))
}

/** "Tue 24 Nov", for a day's accessible name. */
export function formatShortDay(iso: string, locale = "en") {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(at(iso))
}
