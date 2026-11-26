import { formatIsoDate, wallClock } from "@/modules/calendar/lib/zoned"
import type { DailyPoint } from "../schema"

/** Bots beat every 60 s; three missed beats mean something is wrong. */
export const SILENT_AFTER_MS = 3 * 60_000

export type Liveness = { state: "alive" | "silent" | "never"; label: string }

function span(ms: number) {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}

/** "Alive" / "Silent for 12 min" / "No heartbeat yet". */
export function liveness(lastBeatAt: string | null, now: Date): Liveness {
  if (!lastBeatAt) return { state: "never", label: "No heartbeat yet" }
  const age = now.getTime() - new Date(lastBeatAt).getTime()
  if (age < SILENT_AFTER_MS) return { state: "alive", label: "Alive" }
  return { state: "silent", label: `Silent for ${span(age)}` }
}

/** "total_expenses" → "Expenses". */
export function counterLabel(column: string) {
  const words = column.replace(/^total_/, "").replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const KNOWN = new Set(["total_users", "active_users_7d", "active_users_30d", "last_heartbeat_at", "bot_version"])

/**
 * Reads a bot's stats_overview row generically: users and activity by name,
 * any other `total_*` number as a counter, any `*_amounts_minor` object as
 * money per currency. A new bot gets a sensible card without code here.
 */
export function readOverview(row: Record<string, unknown>) {
  const num = (v: unknown) => (v == null ? null : Number(v))
  const counters: { label: string; value: number }[] = []
  let amounts: Record<string, number> = {}
  for (const [key, value] of Object.entries(row)) {
    if (KNOWN.has(key) || value == null) continue
    if (key.endsWith("amounts_minor") && typeof value === "object") {
      amounts = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([c, n]) => [c, Number(n)]))
    } else if (key.startsWith("total_") && Number.isFinite(Number(value))) {
      counters.push({ label: counterLabel(key), value: Number(value) })
    }
  }
  const beat = row.last_heartbeat_at
  return {
    users: num(row.total_users),
    active7d: num(row.active_users_7d),
    active30d: num(row.active_users_30d),
    counters,
    amounts,
    lastBeatAt: beat instanceof Date ? beat.toISOString() : typeof beat === "string" ? new Date(beat).toISOString() : null,
    version: typeof row.bot_version === "string" ? row.bot_version : null,
  }
}

/** Minor units → "28 270,60 CZK"-style text in the viewer's locale. */
export function formatMoney(minor: number, currency: string, locale: string) {
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 })
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  return fmt.format(minor / 10 ** digits)
}

/** The last `days` days ending today, zero-filled, oldest first. */
export function fillDays(points: DailyPoint[], today: string, days = 14): DailyPoint[] {
  const byDay = new Map(points.map((p) => [p.day, p]))
  const end = new Date(`${today}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(end.getTime() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return byDay.get(d) ?? { day: d, messages: 0, activeUsers: 0, expenses: 0 }
  })
}

/** The viewer's calendar date right now ("2026-11-27"), in their timezone. */
export function viewerToday(viewer: { timezone: string }, now = new Date()) {
  const w = wallClock(now, viewer.timezone)
  return formatIsoDate({ year: w.year, month: w.month, day: w.day })
}
