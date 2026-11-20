// Recurring templates: every `interval` weeks, months or years from `startOn`.
// Occurrences are counted from the start, so a rent due on the 31st lands on
// the last day of short months and returns to the 31st afterwards.

import { addDaysIso, addMonthsIso, parseIsoDate } from "./dates"

export type RecurringFreq = "weekly" | "monthly" | "yearly"

export type RecurringRule = {
  freq: RecurringFreq
  interval: number
  startOn: string
  endOn: string | null
}

/** The k-th occurrence (k = 0 is `startOn`). */
export function occurrence(rule: RecurringRule, k: number): string {
  const step = Math.max(1, Math.floor(rule.interval))
  switch (rule.freq) {
    case "weekly":
      return addDaysIso(rule.startOn, 7 * step * k)
    case "monthly":
      return addMonthsIso(rule.startOn, step * k, parseIsoDate(rule.startOn)!.day)
    case "yearly":
      return addMonthsIso(rule.startOn, 12 * step * k, parseIsoDate(rule.startOn)!.day)
  }
}

const MAX_STEPS = 20_000

/** Index of the first occurrence on or after `date`, or null once the rule has ended. */
function indexOnOrAfter(rule: RecurringRule, date: string): number | null {
  for (let k = 0; k < MAX_STEPS; k++) {
    const d = occurrence(rule, k)
    if (rule.endOn && d > rule.endOn) return null
    if (d >= date) return k
  }
  return null
}

/** The first occurrence on or after `date`, or null once the rule has ended. */
export function nextOnOrAfter(rule: RecurringRule, date: string): string | null {
  const k = indexOnOrAfter(rule, date)
  return k === null ? null : occurrence(rule, k)
}

/**
 * What "Generate due" should create: every occurrence from `nextDue` through
 * `today` (and not past `endOn`), at most `limit`. `nextDue` in the result is
 * where the template continues, or null when it has run out.
 */
export function dueDates(
  rule: RecurringRule,
  nextDue: string,
  today: string,
  limit = 400,
): { dates: string[]; nextDue: string | null } {
  const dates: string[] = []
  let k = indexOnOrAfter(rule, nextDue)
  if (k === null) return { dates, nextDue: null }
  for (; ; k++) {
    const d = occurrence(rule, k)
    if (rule.endOn && d > rule.endOn) return { dates, nextDue: null }
    if (d > today || dates.length >= limit) return { dates, nextDue: d }
    dates.push(d)
  }
}

/** "Every month", "Every 2 weeks", "Every year". */
export function describeRule({ freq, interval }: Pick<RecurringRule, "freq" | "interval">) {
  const unit = { weekly: "week", monthly: "month", yearly: "year" }[freq]
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
}
