// Display helpers for ISO days ("2026-11-24"), read at UTC so a day never
// shifts. Spelled out by hand (not Intl), so the app, the bot and the bot's
// prompt (which is parsed back) all say "Tue 24 Nov 2026" the same way.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function parts(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  return { weekday: WEEKDAYS[d.getUTCDay()]!, day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()]!, year: d.getUTCFullYear() }
}

/** "Tuesday 24 Nov". */
export function formatDayLong(iso: string) {
  const p = parts(iso)
  return `${p.weekday} ${p.day} ${p.month}`
}

/** "Tue 24 Nov", with the year when it isn't `currentYear` (pass 0 to always add it): "Tue 24 Nov 2025". */
export function formatDayShort(iso: string, currentYear?: number) {
  const p = parts(iso)
  const base = `${p.weekday.slice(0, 3)} ${p.day} ${p.month}`
  return currentYear !== undefined && p.year !== currentYear ? `${base} ${p.year}` : base
}
