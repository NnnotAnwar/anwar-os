// Pure arithmetic for the monthly report: category spending against the month
// before, and percent changes. No I/O.

import type { CategoryChange } from "../schema"

type Total = { id: string | null; name: string; color: string | null; amountMinor: number }

const CHANGES_SHOWN = 3

/**
 * Joins this month's and last month's spending per category (by id, the name
 * for uncategorised), biggest this month first, then the ones that moved the
 * most (by absolute difference) as `changes`. Amounts are positive minor units.
 */
export function compareCategories(current: Total[], previous: Total[]): { categories: CategoryChange[]; changes: CategoryChange[] } {
  const key = (t: Total) => t.id ?? `name:${t.name}`
  const rows = new Map<string, CategoryChange>()
  for (const t of current) rows.set(key(t), { name: t.name, color: t.color, amountMinor: Math.abs(t.amountMinor), previousMinor: 0 })
  for (const t of previous) {
    const row = rows.get(key(t))
    if (row) row.previousMinor = Math.abs(t.amountMinor)
    else rows.set(key(t), { name: t.name, color: t.color, amountMinor: 0, previousMinor: Math.abs(t.amountMinor) })
  }
  const categories = [...rows.values()]
    .filter((r) => r.amountMinor > 0 || r.previousMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor || b.previousMinor - a.previousMinor || a.name.localeCompare(b.name))
  const changes = categories
    .filter((r) => r.amountMinor !== r.previousMinor)
    .sort((a, b) => Math.abs(b.amountMinor - b.previousMinor) - Math.abs(a.amountMinor - a.previousMinor) || a.name.localeCompare(b.name))
    .slice(0, CHANGES_SHOWN)
  return { categories, changes }
}

/** Whole percent change from `previous` to `current`, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
