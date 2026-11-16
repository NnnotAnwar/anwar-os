// Planuj Glass date and time style: "6 Nov", weekday as a micro line ("FRI"),
// 24-hour times "02:23 – 11:52", ranges with an en dash.

/** Plain "en" formats dates US-style ("Nov 6"); the design wants "6 Nov". */
export function dateLocale(locale: string) {
  return locale === "en" || locale === "en-US" ? "en-GB" : locale
}

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(dateLocale(locale), options)
    cache.set(key, f)
  }
  return f
}

/** "6 Nov" (or "6 Nov 2027" with `year`). */
export function formatDayMonth(instant: Date, locale: string, timeZone: string, year = false) {
  return fmt(locale, { day: "numeric", month: "short", timeZone, ...(year ? { year: "numeric" } : {}) }).format(instant)
}

/** "FRI" for the micro line; CSS uppercases, this keeps it short. */
export function formatWeekdayShort(instant: Date, locale: string, timeZone: string) {
  return fmt(locale, { weekday: "short", timeZone }).format(instant)
}

/** "Friday" */
export function formatWeekdayLong(instant: Date, locale: string, timeZone: string) {
  return fmt(locale, { weekday: "long", timeZone }).format(instant)
}

/** "November 2026" */
export function formatMonthYear(instant: Date, locale: string, timeZone: string) {
  return fmt(locale, { month: "long", year: "numeric", timeZone }).format(instant)
}

/** "09:05", always 24-hour. */
export function formatClock(instant: Date, timeZone: string) {
  return fmt("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(instant)
}

/** "09:00 – 10:30" */
export function formatTimeRange(start: Date, end: Date, timeZone: string) {
  const a = formatClock(start, timeZone)
  const b = formatClock(end, timeZone)
  return a === b ? a : `${a} – ${b}`
}

/** "8h 59m", "45m", "2h" */
export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}
