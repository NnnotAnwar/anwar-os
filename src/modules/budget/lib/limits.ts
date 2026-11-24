import { daysInMonth } from "./dates"

// Monthly category limits: how full a limit is, and when to warn. Pure, shared
// by Budget → Limits, the Today widget, the expense bot's "left" line and
// osbot's alerts (src/modules/osbot/digest.ts).

/** Warn at 90 % of a limit, and again once it's used up. */
export const LIMIT_THRESHOLDS = [90, 100] as const
export type LimitThreshold = (typeof LIMIT_THRESHOLDS)[number]

export type LimitStatus = "ok" | "near" | "over"

/** "ok" under 90 %, "near" from 90 % until the limit, "over" at the limit and beyond. */
export function limitStatus(spentMinor: number, limitMinor: number): LimitStatus {
  if (limitMinor <= 0) return "ok"
  if (spentMinor >= limitMinor) return "over"
  if (spentMinor * 100 >= limitMinor * 90) return "near"
  return "ok"
}

/** Fill colour of a limit's bar: accent (the default), amber from 90 %, red once used up. */
export const limitBarClass = (status: LimitStatus) =>
  status === "over" ? "bg-destructive" : status === "near" ? "bg-warning-text" : undefined

/** The thresholds this month's spending has reached, lowest first: [], [90] or [90, 100]. */
export function reachedThresholds(spentMinor: number, limitMinor: number): LimitThreshold[] {
  if (limitMinor <= 0) return []
  return LIMIT_THRESHOLDS.filter((pct) => spentMinor * 100 >= limitMinor * pct)
}

/** Whole percent used, floored (99.9 % shows as 99 %, not 100 %); capped for display. */
export function percentUsed(spentMinor: number, limitMinor: number): number {
  if (limitMinor <= 0) return 0
  return Math.min(999, Math.floor((spentMinor * 100) / limitMinor))
}

/**
 * Where this month's spending ends up at today's pace: spent ÷ days gone ×
 * days in the month. Null outside the current month or before a pace means
 * anything (the first two days).
 */
export function monthPace(spentMinor: number, month: string, today: string): number | null {
  if (today.slice(0, 7) !== month) return null
  const day = Number(today.slice(8, 10))
  if (day < 3) return null
  const days = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))
  return Math.round((spentMinor / day) * days)
}

/** The osbot_deliveries key of one alert: `<category id>:<YYYY-MM>:<90|100>`. */
export const limitAlertKey = (categoryId: string, month: string, threshold: LimitThreshold) => `${categoryId}:${month}:${threshold}`
