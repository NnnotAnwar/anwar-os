// Natural-language quick add for tasks. Client-safe and pure: the caller passes
// today's date in the viewer's zone and the names of their lists.
//
//   "Call the bank tomorrow 10:00 !high #University"
//   "Pay rent every month on 1st"
//   "Odevzdat úkol 21. listopadu !"
//
// Recognised (English, with Czech where it's cheap): dates (today, tomorrow,
// weekdays, "next week", "in 3 days", "21 Nov", "Nov 21", "21.11.", ISO),
// times ("10:00", "3pm", "at 5"), priority ("!", "!!", "!high", "!low"), a list
// ("#University", or "#Planuj Směny" when such a list exists) and repeats
// ("every day", "every weekday", "every Mon and Thu", "every 2 weeks",
// "every month on 1st", "yearly", "každý den"). Everything else is the title.

import { formatRRule, type Recurrence, type Weekday } from "@/modules/calendar/lib/recurrence"
import { addDays, daysInMonth, diffDays, weekdayOf, type LocalDate } from "@/modules/calendar/lib/zoned"
import type { TaskPriority } from "@/db/schema/tasks"

export type ParsedTask = {
  title: string
  dueDate: LocalDate | null
  dueTime: { hour: number; minute: number } | null
  priority: TaskPriority
  /** A known list's exact name, or the tag as typed when no list matches. */
  list: string | null
  /** True when `list` matched one of the given lists. */
  listExists: boolean
  repeat: Recurrence | null
  /** RRULE value for `repeat`, or null. */
  rrule: string | null
}

// Unicode-aware word edges (Czech letters are not \w).
const L = String.raw`(?<![\p{L}\p{N}])`
const R = String.raw`(?![\p{L}\p{N}])`

type Lexeme = { re: RegExp; words: string[] }

function alt(words: string[]) {
  return [...words].sort((a, b) => b.length - a.length).join("|")
}

const WEEKDAYS: string[][] = [
  ["monday", "mon", "pondělí", "pondeli", "po"],
  ["tuesday", "tues", "tue", "úterý", "utery", "út", "ut"],
  ["wednesday", "wed", "středa", "středu", "streda", "stredu", "st"],
  ["thursday", "thurs", "thu", "čtvrtek", "ctvrtek", "čt", "ct"],
  ["friday", "fri", "pátek", "patek", "pá", "pa"],
  ["saturday", "sat", "sobota", "sobotu", "so"],
  ["sunday", "sun", "neděle", "neděli", "nedele", "nedeli", "ne"],
]
// Two-letter Czech abbreviations ("po", "ne", "st") collide with ordinary
// words, so they only count inside a repeat ("každé po") — never as a lone date.
const SAFE_WEEKDAYS = WEEKDAYS.map((forms) => forms.filter((f) => f.length > 2))
const ALL_WEEKDAY_WORDS = SAFE_WEEKDAYS.flat()

const MONTHS: string[][] = [
  ["january", "jan", "leden", "ledna"],
  ["february", "feb", "únor", "února", "unor", "unora"],
  ["march", "mar", "březen", "března", "brezen", "brezna"],
  ["april", "apr", "duben", "dubna"],
  ["may", "květen", "května", "kveten", "kvetna"],
  ["june", "jun", "červen", "června", "cerven", "cervna"],
  ["july", "jul", "červenec", "července", "cervenec", "cervence"],
  ["august", "aug", "srpen", "srpna"],
  ["september", "sept", "sep", "září", "zari"],
  ["october", "oct", "říjen", "října", "rijen", "rijna"],
  ["november", "nov", "listopad", "listopadu"],
  ["december", "dec", "prosinec", "prosince"],
]
const MONTH_WORDS = alt(MONTHS.flat())

function weekdayIndex(word: string): Weekday | null {
  const lower = word.toLowerCase()
  const i = WEEKDAYS.findIndex((forms) => forms.includes(lower))
  return i < 0 ? null : ((i + 1) as Weekday)
}

function monthIndex(word: string): number | null {
  const lower = word.toLowerCase().replace(/\.$/, "")
  const i = MONTHS.findIndex((forms) => forms.includes(lower))
  return i < 0 ? null : i + 1
}

/** Lowercase, no diacritics, `_`/`-` as spaces: how list names are compared. */
export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** The next date on or after `from` whose day of month is `day` (skipping short months). */
function nextDayOfMonth(from: LocalDate, day: number): LocalDate {
  let { year, month } = from
  if (from.day > day) month++
  for (let i = 0; i < 24; i++) {
    if (month > 12) {
      month = 1
      year++
    }
    if (day <= daysInMonth(year, month)) return { year, month, day }
    month++
  }
  return from
}

/** The next `weekday` after `from`; `from`'s own weekday means a week later unless `inclusive`. */
function nextWeekday(from: LocalDate, weekday: Weekday, inclusive = false): LocalDate {
  const ahead = (weekday - weekdayOf(from) + 7) % 7
  return addDays(from, ahead === 0 && !inclusive ? 7 : ahead)
}

/** A day/month without a year: this year, or next year once it has passed. */
function upcoming(today: LocalDate, month: number, day: number, year?: number): LocalDate | null {
  if (year !== undefined) {
    if (year < 100) year += 2000
    return day <= daysInMonth(year, month) ? { year, month, day } : null
  }
  for (const y of [today.year, today.year + 1]) {
    if (day > daysInMonth(y, month)) continue
    const date = { year: y, month, day }
    if (diffDays(today, date) >= 0) return date
  }
  return day <= daysInMonth(today.year + 1, month) ? { year: today.year + 1, month, day } : null
}

type Ctx = { text: string; today: LocalDate }

/** Runs `re` once on the text; on a match, blanks it out and returns the groups. */
function take(ctx: Ctx, re: RegExp): RegExpExecArray | null {
  const m = re.exec(ctx.text)
  if (!m) return null
  ctx.text = ctx.text.slice(0, m.index) + " " + ctx.text.slice(m.index + m[0].length)
  return m
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function takeList(ctx: Ctx, lists: string[]): { name: string; exists: boolean } | null {
  // Known lists first, longest name first, so "#Planuj Směny" beats "#Planuj".
  const known = [...lists].sort((a, b) => b.length - a.length)
  const hashes = [...ctx.text.matchAll(/(?:^|\s)#/g)]
  for (const hash of hashes) {
    const start = hash.index + hash[0].length
    const rest = ctx.text.slice(start)
    for (const name of known) {
      const candidate = rest.slice(0, name.length)
      const after = rest.charAt(name.length)
      if (normalizeName(candidate) === normalizeName(name) && (!after || /[\s,.;!?]/.test(after))) {
        ctx.text = ctx.text.slice(0, start - 1) + " " + rest.slice(name.length)
        return { name, exists: true }
      }
    }
  }
  const m = take(ctx, /(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/u)
  if (!m) return null
  const typed = m[1]!.replace(/_/g, " ")
  const match = lists.find((l) => normalizeName(l) === normalizeName(typed))
  return match ? { name: match, exists: true } : { name: typed.slice(0, 60), exists: false }
}

function takePriority(ctx: Ctx): TaskPriority | null {
  const m = take(ctx, new RegExp(String.raw`(?:^|\s)(!{1,3})(high|hi|h|low|lo|l|none|vysoká|vysoka|nízká|nizka)?(?=\s|$)`, "iu"))
  if (!m) return null
  const word = m[2]?.toLowerCase()
  if (word) {
    if (["high", "hi", "h", "vysoká", "vysoka"].includes(word)) return "high"
    if (["low", "lo", "l", "nízká", "nizka"].includes(word)) return "low"
    return "none"
  }
  return m[1]!.length >= 2 ? "high" : "low"
}

type RepeatResult = { rule: Recurrence; anchor: (today: LocalDate) => LocalDate; monthDay?: number }

const UNIT: Record<string, Recurrence["freq"]> = {
  day: "daily",
  days: "daily",
  week: "weekly",
  weeks: "weekly",
  month: "monthly",
  months: "monthly",
  year: "yearly",
  years: "yearly",
}

const ADVERB: Record<string, Recurrence["freq"]> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  yearly: "yearly",
  annually: "yearly",
  denně: "daily",
  denne: "daily",
  týdně: "weekly",
  tydne: "weekly",
  měsíčně: "monthly",
  mesicne: "monthly",
  ročně: "yearly",
  rocne: "yearly",
}

const CZ_UNIT: Record<string, Recurrence["freq"]> = {
  den: "daily",
  týden: "weekly",
  tyden: "weekly",
  měsíc: "monthly",
  mesic: "monthly",
  rok: "yearly",
}

const ORDINAL = String.raw`(\d{1,2})(?:st|nd|rd|th|\.)?`
const MONTH_DAY_SUFFIX = String.raw`(?:\s+(?:on\s+)?(?:the\s+)?${ORDINAL}(?:\s+(?:of\s+)?(?:the\s+|each\s+|every\s+)?month)?)?`

function weekdayList(text: string): Weekday[] {
  return [...new Set(text.split(/\s*(?:,|\band\b|&|\ba\b)\s*|\s+/u).map(weekdayIndex).filter((d): d is Weekday => d !== null))].sort(
    (a, b) => a - b,
  )
}

function monthDayRule(day: number, interval = 1): RepeatResult | null {
  if (day < 1 || day > 31) return null
  return { rule: { freq: "monthly", interval }, anchor: (t) => nextDayOfMonth(t, day), monthDay: day }
}

function weeklyRule(days: Weekday[], interval = 1): RepeatResult {
  return {
    rule: { freq: "weekly", interval, byWeekday: days },
    anchor: (t) => {
      const candidates = days.map((d) => nextWeekday(t, d, true))
      return candidates.sort((a, b) => diffDays(b, a))[0]!
    },
  }
}

function takeRepeat(ctx: Ctx): RepeatResult | null {
  const weekdayAlt = alt(WEEKDAYS.flat())
  const weekdayRun = String.raw`(?:${weekdayAlt})(?:(?:\s*,\s*|\s+and\s+|\s*&\s*|\s+a\s+|\s+)(?:${weekdayAlt}))*`

  // every weekday / every weekend
  let m = take(ctx, new RegExp(String.raw`${L}every\s+(weekday|workday|weekend)s?${R}`, "iu"))
  if (m) {
    const days: Weekday[] = /weekend/i.test(m[1]!) ? [6, 7] : [1, 2, 3, 4, 5]
    return weeklyRule(days)
  }

  // every [other|N] week(s) on Mon, Thu / every Mon and Thu / každé pondělí
  m = take(
    ctx,
    new RegExp(String.raw`${L}(?:every|každ(?:ý|é|ou|á|y|e))\s+(?:(other)\s+|(\d{1,2})\s+)?(?:weeks?\s+on\s+)?(${weekdayRun})${R}`, "iu"),
  )
  if (m) {
    const days = weekdayList(m[3]!)
    if (days.length) return weeklyRule(days, m[1] ? 2 : m[2] ? Number(m[2]) : 1)
  }

  // every [other|N] day/week/month/year [on the 1st]
  m = take(
    ctx,
    new RegExp(String.raw`${L}every\s+(?:(other)\s+|(\d{1,3})\s+)?(days?|weeks?|months?|years?)${MONTH_DAY_SUFFIX}${R}`, "iu"),
  )
  if (m) {
    const interval = m[1] ? 2 : m[2] ? Math.max(1, Number(m[2])) : 1
    const freq = UNIT[m[3]!.toLowerCase()]!
    if (freq === "monthly" && m[4]) return monthDayRule(Number(m[4]), interval)
    if (freq === "monthly" || freq === "yearly") return { rule: { freq, interval }, anchor: (t) => t }
    return { rule: { freq, interval }, anchor: (t) => t }
  }

  // every 1st / every 15th of the month
  m = take(ctx, new RegExp(String.raw`${L}every\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)(?:\s+(?:of\s+)?(?:the\s+|each\s+)?month)?${R}`, "iu"))
  if (m) return monthDayRule(Number(m[1]))

  // daily / monthly on the 1st / každý den / každý měsíc
  m = take(ctx, new RegExp(String.raw`${L}(${alt(Object.keys(ADVERB))})${MONTH_DAY_SUFFIX}${R}`, "iu"))
  if (m) {
    const freq = ADVERB[m[1]!.toLowerCase()]!
    if (freq === "monthly" && m[2]) return monthDayRule(Number(m[2]))
    return { rule: { freq, interval: 1 }, anchor: (t) => t }
  }
  m = take(ctx, new RegExp(String.raw`${L}každ(?:ý|é|ou|á|y|e)\s+(${alt(Object.keys(CZ_UNIT))})${R}`, "iu"))
  if (m) return { rule: { freq: CZ_UNIT[m[1]!.toLowerCase()]!, interval: 1 }, anchor: (t) => t }

  return null
}

function takeTime(ctx: Ctx): { hour: number; minute: number } | null {
  const pre = String.raw`(?:(?:at|@|v|ve|o)\s*)?`
  // 3pm, 3:30 pm, 11 a.m.
  let m = take(ctx, new RegExp(String.raw`${L}${pre}(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?m\.?${R}`, "iu"))
  if (m) {
    let hour = Number(m[1])
    const minute = Number(m[2] ?? 0)
    if (hour < 1 || hour > 12 || minute > 59) return null
    const pm = m[3]!.toLowerCase() === "p"
    if (pm && hour < 12) hour += 12
    if (!pm && hour === 12) hour = 0
    return { hour, minute }
  }
  // 10:00, 9.30 (a dotted pair followed by another dot is a date, handled earlier)
  m = take(ctx, new RegExp(String.raw`${L}${pre}([01]?\d|2[0-3])[:.]([0-5]\d)(?![\p{L}\p{N}.:])`, "iu"))
  if (m) return { hour: Number(m[1]), minute: Number(m[2]) }
  // at 5 / at 17 — bare hours need "at"; 1–7 read as afternoon.
  m = take(ctx, new RegExp(String.raw`${L}(?:at|@)\s*([01]?\d|2[0-3])(?![\p{L}\p{N}:.])`, "iu"))
  if (m) {
    let hour = Number(m[1])
    if (hour >= 1 && hour <= 7) hour += 12
    return { hour, minute: 0 }
  }
  m = take(ctx, new RegExp(String.raw`${L}(?:at\s+)?(noon|midday|poledne)${R}`, "iu"))
  if (m) return { hour: 12, minute: 0 }
  return null
}

function takeDate(ctx: Ctx): LocalDate | null {
  const { today } = ctx
  const pre = String.raw`(?:(?:on|by|due|for|v|ve|do|na)\s+)?`

  // 2026-11-21
  let m = take(ctx, new RegExp(String.raw`${L}${pre}(\d{4})-(\d{2})-(\d{2})${R}`, "iu"))
  if (m) return upcoming(today, Number(m[2]), Number(m[3]), Number(m[1]))

  // 21.11. / 21. 11. 2026
  m = take(ctx, new RegExp(String.raw`${L}${pre}(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}))?(?![\p{N}])`, "iu"))
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return upcoming(today, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined)

  // 21/11, 21/11/2026 (day first)
  m = take(ctx, new RegExp(String.raw`${L}${pre}(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?${R}`, "iu"))
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return upcoming(today, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined)

  // 21 Nov, 21st of November, 21. listopadu
  m = take(
    ctx,
    new RegExp(String.raw`${L}${pre}(?:the\s+)?(\d{1,2})(?:st|nd|rd|th|\.)?\s*(?:of\s+)?(${MONTH_WORDS})\.?(?:\s+(\d{4}))?${R}`, "iu"),
  )
  if (m) return upcoming(today, monthIndex(m[2]!)!, Number(m[1]), m[3] ? Number(m[3]) : undefined)

  // Nov 21, November 21st, 2026
  m = take(ctx, new RegExp(String.raw`${L}${pre}(${MONTH_WORDS})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?${R}`, "iu"))
  if (m) return upcoming(today, monthIndex(m[1]!)!, Number(m[2]), m[3] ? Number(m[3]) : undefined)

  // day after tomorrow / pozítří
  m = take(ctx, new RegExp(String.raw`${L}(?:the\s+)?(?:day\s+after\s+tomorrow|pozítří|pozitri)${R}`, "iu"))
  if (m) return addDays(today, 2)

  // today / tonight / tomorrow / dnes / zítra
  m = take(ctx, new RegExp(String.raw`${L}(today|tod|tonight|dnes|dneska|tomorrow|tmrw|tmr|zítra|zitra)${R}`, "iu"))
  if (m) return /^(today|tod|tonight|dnes|dneska)$/i.test(m[1]!) ? today : addDays(today, 1)

  // in 3 days / in 2 weeks / in a month / za 3 dny
  m = take(ctx, new RegExp(String.raw`${L}in\s+(a|an|one|\d{1,3})\s+(days?|weeks?|months?)${R}`, "iu"))
  if (m) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1
    const unit = m[2]!.toLowerCase()
    if (unit.startsWith("day")) return addDays(today, n)
    if (unit.startsWith("week")) return addDays(today, 7 * n)
    const index = today.month - 1 + n
    const year = today.year + Math.floor(index / 12)
    const month = (index % 12) + 1
    return { year, month, day: Math.min(today.day, daysInMonth(year, month)) }
  }
  m = take(ctx, new RegExp(String.raw`${L}za\s+(\d{1,3})\s+(dn[ůuíi]|dny|den|týdn[ůuy]|tydn[uy]|týden|tyden)${R}`, "iu"))
  if (m) return addDays(today, (/^t/i.test(m[2]!) ? 7 : 1) * Number(m[1]))

  // next week / next month / příští týden
  m = take(ctx, new RegExp(String.raw`${L}(?:next|příští|pristi)\s+(week|month|týden|tyden|měsíc|mesic)${R}`, "iu"))
  if (m) {
    if (/^(week|týden|tyden)$/i.test(m[1]!)) return nextWeekday(today, 1)
    return nextDayOfMonth(addDays(today, 1), 1)
  }

  // this weekend / weekend / o víkendu
  m = take(ctx, new RegExp(String.raw`${L}(?:(?:this|on\s+the|o)\s+)?(?:weekend|víkendu|vikendu|víkend|vikend)${R}`, "iu"))
  if (m) {
    const wd = weekdayOf(today)
    return wd >= 6 ? today : nextWeekday(today, 6, true)
  }

  // on the 5th / by the 21st (this month or next)
  m = take(ctx, new RegExp(String.raw`${L}(?:on|by|due)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)${R}`, "iu"))
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) return nextDayOfMonth(today, Number(m[1]))

  // [next|this|on] friday / v pátek
  m = take(ctx, new RegExp(String.raw`${L}(?:(next|this|on|v|ve|příští|pristi)\s+)?(${alt(ALL_WEEKDAY_WORDS)})${R}`, "iu"))
  if (m) {
    const wd = weekdayIndex(m[2]!)!
    const qualifier = m[1]?.toLowerCase()
    return nextWeekday(today, wd, qualifier === "this")
  }
  return null
}

function cleanTitle(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:\s+|^)(?:on|at|by|due|for|in|v|ve|do|na|-|–|,)$/iu, "")
    .replace(/^(?:-|–|,)\s*/u, "")
    .trim()
}

/** Parses quick-add text. `today` is the viewer's local date. */
export function parseTask(input: string, today: LocalDate, lists: string[] = []): ParsedTask {
  const ctx: Ctx = { text: ` ${input.replace(/\s+/g, " ").trim()} `, today }

  const list = takeList(ctx, lists)
  const priority = takePriority(ctx) ?? "none"
  const repeat = takeRepeat(ctx)
  let dueDate = takeDate(ctx)
  const dueTime = takeTime(ctx)
  // A second date phrase after the first ("tomorrow" + "21 Nov") is ignored;
  // a time alone means today.
  if (!dueDate && dueTime) dueDate = today

  if (repeat) {
    if (!dueDate) dueDate = repeat.anchor(today)
    else if (repeat.monthDay && dueDate.day !== repeat.monthDay) dueDate = nextDayOfMonth(dueDate, repeat.monthDay)
    else if (repeat.rule.byWeekday?.length && !repeat.rule.byWeekday.includes(weekdayOf(dueDate) as Weekday)) {
      dueDate = repeat.anchor(dueDate)
    }
  }

  return {
    title: cleanTitle(ctx.text).slice(0, 300),
    dueDate,
    dueTime,
    priority,
    list: list?.name ?? null,
    listExists: list?.exists ?? false,
    repeat: repeat?.rule ?? null,
    rrule: repeat ? formatRRule(repeat.rule, true) : null,
  }
}
