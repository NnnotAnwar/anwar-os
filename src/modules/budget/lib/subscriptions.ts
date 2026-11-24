// Recurring expenses as subscriptions: what they cost a month and a year, when
// they charge next, and which charges fall in a date range. Pure: safe on the
// server, in the browser and in tests. Amounts here are positive (money out).

import { addDaysIso } from "./dates"
import { nextOnOrAfter, occurrence, type RecurringRule } from "./recurring"

export type CadenceRule = Pick<RecurringRule, "freq" | "interval">

/** Charges per year: monthly 12, every 2 weeks 26, yearly 1, every 3 years 1/3. */
export function chargesPerYear({ freq, interval }: CadenceRule): number {
  const n = Math.max(1, Math.floor(interval))
  switch (freq) {
    case "weekly":
      return 52 / n
    case "monthly":
      return 12 / n
    case "yearly":
      return 1 / n
  }
}

/** What one charge of `amountMinor` costs a year, rounded to whole minor units. */
export function yearlyCost(amountMinor: number, rule: CadenceRule): number {
  return Math.round(Math.abs(amountMinor) * chargesPerYear(rule))
}

/** The monthly equivalent: a year's cost spread over twelve months. */
export function monthlyCost(amountMinor: number, rule: CadenceRule): number {
  return Math.round((Math.abs(amountMinor) * chargesPerYear(rule)) / 12)
}

type ChargeRule = RecurringRule & { nextDue: string; active: boolean }

/**
 * The next charge on or after `today`: never before the template's next due
 * date (earlier ones are already recorded). Null when paused or finished.
 */
export function nextCharge(rule: ChargeRule, today: string): string | null {
  if (!rule.active) return null
  return nextOnOrAfter(rule, rule.nextDue > today ? rule.nextDue : today)
}

const MAX_CHARGES = 400

/**
 * Charges dated `from`…`to` (inclusive) that are not recorded yet, i.e. on or
 * after the template's next due date. Empty for a paused template.
 */
export function chargesBetween(rule: ChargeRule, from: string, to: string): string[] {
  if (!rule.active || to < from) return []
  const start = rule.nextDue > from ? rule.nextDue : from
  const first = nextOnOrAfter(rule, start)
  if (!first || first > to) return []
  const dates: string[] = []
  // Walk occurrences by index from the first one in range.
  let k = 0
  while (occurrence(rule, k) < first) k++
  for (; dates.length < MAX_CHARGES; k++) {
    const d = occurrence(rule, k)
    if (d > to || (rule.endOn && d > rule.endOn)) break
    dates.push(d)
  }
  return dates
}

/** `days` calendar days starting at `from`: [from, from + days − 1]. */
export function dayRange(from: string, days: number): { from: string; to: string } {
  return { from, to: addDaysIso(from, Math.max(1, days) - 1) }
}

export type CostRow = { currency: string; amountMinor: number; freq: RecurringRule["freq"]; interval: number }

/** Monthly and yearly totals per currency, `base` first, then by monthly cost. */
export function totalsByCurrency(rows: CostRow[], base: string) {
  const map = new Map<string, { currency: string; monthlyMinor: number; yearlyMinor: number; count: number }>()
  for (const row of rows) {
    const entry = map.get(row.currency) ?? { currency: row.currency, monthlyMinor: 0, yearlyMinor: 0, count: 0 }
    entry.yearlyMinor += yearlyCost(row.amountMinor, row)
    entry.count += 1
    map.set(row.currency, entry)
  }
  // Monthly from the yearly sum, so 12 × monthly always matches the yearly line.
  const totals = [...map.values()].map((t) => ({ ...t, monthlyMinor: Math.round(t.yearlyMinor / 12) }))
  return totals.sort((a, b) => (a.currency === base ? -1 : b.currency === base ? 1 : b.monthlyMinor - a.monthlyMinor))
}

/** "Tomorrow", "Today", "In 3 days", else null (the caller shows the date). */
export function relativeDay(date: string, today: string): string | null {
  if (date === today) return "Today"
  if (date === addDaysIso(today, 1)) return "Tomorrow"
  for (let n = 2; n <= 6; n++) if (date === addDaysIso(today, n)) return `In ${n} days`
  return null
}
