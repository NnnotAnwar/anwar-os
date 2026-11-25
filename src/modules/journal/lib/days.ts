// Calendar maths for the journal on ISO days ("2026-11-25"), at UTC so a day
// never shifts. Pure: the page, the heat-map and the tests share it.

import type { DayMood, JournalStats, Mood, YearDay } from "../schema"

const DAY = 86_400_000
const at = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

export function addDays(day: string, days: number) {
  return iso(new Date(at(day).getTime() + days * DAY))
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string) {
  return (at(day).getUTCDay() + 6) % 7
}

export type HeatCell = { day: string; mood: Mood | null; hasText: boolean; future: boolean }

export type HeatMap = {
  year: number
  /** Columns of seven (Monday first); null where the week runs outside the year. */
  weeks: (HeatCell | null)[][]
  /** Month names over the first column that holds their 1st. */
  months: { label: string; column: number }[]
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** A GitHub-style year: one column per week, Monday at the top. */
export function heatMap(year: number, days: YearDay[], today: string): HeatMap {
  const byDay = new Map(days.map((d) => [d.day, d]))
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const weeks: (HeatCell | null)[][] = []
  const months: HeatMap["months"] = []
  let day = addDays(first, -weekdayIndex(first))
  while (day <= last) {
    const week: (HeatCell | null)[] = []
    for (let i = 0; i < 7; i++) {
      if (day < first || day > last) week.push(null)
      else {
        const entry = byDay.get(day)
        week.push({ day, mood: entry?.mood ?? null, hasText: entry?.hasText ?? false, future: day > today })
        if (day.endsWith("-01")) months.push({ label: MONTH_SHORT[Number(day.slice(5, 7)) - 1]!, column: weeks.length })
      }
      day = addDays(day, 1)
    }
    weeks.push(week)
  }
  return { year, weeks, months }
}

/** Days written, the average mood and the best and worst day of a month's entries. */
export function monthStats(month: string, entries: { day: string; mood: Mood | null; text: string }[]): JournalStats {
  const rated = entries.filter((e): e is DayMood => e.mood !== null)
  const sum = rated.reduce((s, e) => s + e.mood, 0)
  // Ties: the earlier day wins, so the result doesn't move as the month goes on.
  const sorted = [...rated].sort((a, b) => a.day.localeCompare(b.day))
  const best = sorted.reduce<DayMood | null>((top, e) => (!top || e.mood > top.mood ? e : top), null)
  const worst = sorted.reduce<DayMood | null>((low, e) => (!low || e.mood < low.mood ? e : low), null)
  const pick = (e: DayMood | null) => (e ? { day: e.day, mood: e.mood, text: e.text } : null)
  return {
    month,
    written: entries.length,
    rated: rated.length,
    averageMood: rated.length ? Math.round((sum / rated.length) * 10) / 10 : null,
    best: pick(best),
    worst: best && worst && worst.mood < best.mood ? pick(worst) : null,
  }
}
