import { z } from "zod"

// The journal: one line a day with a mood from 1 (bad) to 5 (great). Shared by
// the page, the Today widget, osbot and the AI / MCP actions.

export const TEXT_MAX = 500

/** Mood faces, the same in the app and in Telegram. */
export const MOODS = [
  { value: 1, emoji: "😞", label: "Bad" },
  { value: 2, emoji: "🙁", label: "Low" },
  { value: 3, emoji: "😐", label: "Okay" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😄", label: "Great" },
] as const

export type Mood = 1 | 2 | 3 | 4 | 5

export function moodOf(value: number | null | undefined) {
  return MOODS.find((m) => m.value === value) ?? null
}

const isoDate = z.iso.date("Use a date like 2026-11-25.")
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 21:30.")
const mood = z.number().int().min(1, "Pick a mood from 1 to 5.").max(5, "Pick a mood from 1 to 5.")
const line = z.string().max(TEXT_MAX, `Keep it to one line, under ${TEXT_MAX} characters.`)

export const getEntryInput = z.object({
  /** Default: the user's today. */
  day: isoDate.optional(),
})

/**
 * Sets the day's mood and/or line; a field left out keeps its value. A day
 * with neither a mood nor a line is removed.
 */
export const upsertEntryInput = z.object({
  day: isoDate.optional(),
  mood: mood.nullable().optional(),
  text: line.optional(),
})

export const listEntriesInput = z.object({
  /** Words to look for in the lines. */
  query: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Only days before this one (paging: pass the last day you got). */
  before: isoDate.optional(),
  limit: z.number().int().min(1).max(400).default(30),
})

export const deleteEntryInput = z.object({ day: isoDate })
export const yearInput = z.object({ year: z.number().int().min(2000).max(2100).optional() })
export const statsInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.") })
export const updateSettingsInput = z.object({ promptEnabled: z.boolean(), promptTime: clockTime })

export type JournalEntry = {
  id: string
  day: string
  mood: Mood | null
  text: string
  createdAt: string
  updatedAt: string
}

/** What a day was before a change, for Undo; null = there was no entry. */
export type EntrySnapshot = { mood: Mood | null; text: string } | null

export type UpsertResult = { day: string; entry: JournalEntry | null; previous: EntrySnapshot }

export type YearDay = { day: string; mood: Mood | null; hasText: boolean }
export type JournalYear = { year: number; today: string; days: YearDay[] }

export type DayMood = { day: string; mood: Mood; text: string }
export type JournalStats = {
  month: string
  /** Days with an entry. */
  written: number
  /** Days with a mood, and their average (one decimal), or null. */
  rated: number
  averageMood: number | null
  best: DayMood | null
  /** Null when every rated day had the same mood (there is no worse one). */
  worst: DayMood | null
}

export type JournalSettings = { promptEnabled: boolean; promptTime: string }
