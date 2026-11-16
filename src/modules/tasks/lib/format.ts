// How due dates read in task rows: "Today", "Tomorrow", "Fri", "21 Nov".
// Client-safe; dates are floating calendar dates, formatted in UTC.
import { dateLocale } from "@/modules/calendar/lib/format"
import { describeRecurrence, parseRRule } from "@/modules/calendar/lib/recurrence"
import { diffDays, parseIsoDate, utcMidnight, type LocalDate } from "@/modules/calendar/lib/zoned"

export type DueTone = "overdue" | "today" | "soon" | "later"

export function dueLabel(dueIso: string, todayIso: string, locale: string): { text: string; tone: DueTone } {
  const due = parseIsoDate(dueIso)
  const today = parseIsoDate(todayIso)
  if (!due || !today) return { text: dueIso, tone: "later" }
  const days = diffDays(today, due)
  const loc = dateLocale(locale)
  const at = utcMidnight(due)
  if (days === 0) return { text: "Today", tone: "today" }
  if (days === 1) return { text: "Tomorrow", tone: "soon" }
  if (days === -1) return { text: "Yesterday", tone: "overdue" }
  if (days > 1 && days < 7) {
    return { text: new Intl.DateTimeFormat(loc, { weekday: "long", timeZone: "UTC" }).format(at), tone: "soon" }
  }
  const sameYear = due.year === today.year
  const text = new Intl.DateTimeFormat(loc, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(at)
  return { text, tone: days < 0 ? "overdue" : "later" }
}

/** "Tuesday 17 Nov" for Upcoming's day headings; "Tomorrow" stays a word. */
export function dayHeading(dateIso: string, todayIso: string, locale: string) {
  const date = parseIsoDate(dateIso)!
  const loc = dateLocale(locale)
  const at = utcMidnight(date)
  const weekday = new Intl.DateTimeFormat(loc, { weekday: "long", timeZone: "UTC" }).format(at)
  const dayMonth = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: "UTC" }).format(at)
  const days = diffDays(parseIsoDate(todayIso)!, date)
  return { title: days === 1 ? "Tomorrow" : weekday, meta: dayMonth }
}

/** "Monthly", "Weekly on Mon, Thu"; null when there's no (readable) repeat. */
export function repeatLabel(rrule: string | null, locale: string) {
  const rule = parseRRule(rrule)
  return rule ? describeRecurrence(rule, dateLocale(locale), true, "UTC") : null
}

export const isoFromLocal = (date: LocalDate) =>
  `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
