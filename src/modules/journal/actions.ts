import "server-only"
import { and, asc, desc, eq, gte, ilike, lt, lte, type SQL } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { journalEntries as e, journalSettings as s } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { shiftMonth } from "@/modules/budget/lib/dates"
import { formatIsoDate, wallClock } from "@/modules/calendar/lib/zoned"
import { monthStats } from "./lib/days"
import {
  deleteEntryInput,
  getEntryInput,
  listEntriesInput,
  statsInput,
  updateSettingsInput,
  upsertEntryInput,
  yearInput,
  type EntrySnapshot,
  type JournalEntry,
  type JournalSettings,
  type JournalStats,
  type JournalYear,
  type Mood,
  type UpsertResult,
} from "./schema"

/** A message the UI and the bot can show as is (a future day, a day too long ago…). */
export class JournalInputError extends Error {}

const DEFAULT_SETTINGS: JournalSettings = { promptEnabled: true, promptTime: "21:30" }

const columns = { id: e.id, day: e.day, mood: e.mood, text: e.text, createdAt: e.createdAt, updatedAt: e.updatedAt }
type Row = { id: string; day: string; mood: number | null; text: string; createdAt: Date; updatedAt: Date }

function toEntry(row: Row): JournalEntry {
  return {
    id: row.id,
    day: row.day,
    mood: row.mood as Mood | null,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** One line: whitespace and line breaks collapse to single spaces. */
export function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

/** The viewer's calendar date: "today" depends on their zone, not the server's. */
export async function viewerToday() {
  // The session first: reading the clock before any request data breaks prerendering.
  const viewer = await requireViewer()
  const w = wallClock(new Date(), viewer.timezone)
  return formatIsoDate({ year: w.year, month: w.month, day: w.day })
}

async function checkDay(day: string | undefined) {
  const today = await viewerToday()
  const target = day ?? today
  if (target > today) throw new JournalInputError("That day hasn't come yet.")
  return { day: target, today }
}

async function findEntry(tx: Tx, day: string) {
  const [row] = await tx.select(columns).from(e).where(eq(e.day, day))
  return row ? toEntry(row) : null
}

const snapshot = (entry: JournalEntry | null): EntrySnapshot => (entry ? { mood: entry.mood, text: entry.text } : null)

/**
 * Sets a day's mood and/or line (a field left undefined keeps its value).
 * A day left with neither is deleted. Returns the entry and what it was
 * before, for Undo.
 */
export async function upsertEntry(input: z.infer<typeof upsertEntryInput>): Promise<UpsertResult> {
  const { day } = await checkDay(input.day)
  return asViewer(async (tx) => {
    const before = await findEntry(tx, day)
    const mood = input.mood === undefined ? (before?.mood ?? null) : input.mood
    const text = input.text === undefined ? (before?.text ?? "") : oneLine(input.text)
    if (mood === null && text === "") {
      if (before) await tx.delete(e).where(eq(e.day, day))
      return { day, entry: null, previous: snapshot(before) }
    }
    const [row] = await tx
      .insert(e)
      .values({ day, mood, text })
      .onConflictDoUpdate({ target: [e.ownerId, e.day], set: { mood, text } })
      .returning(columns)
    return { day, entry: toEntry(row!), previous: snapshot(before) }
  })
}

export async function readSettings(tx: Tx): Promise<JournalSettings> {
  const [row] = await tx.select({ promptEnabled: s.promptEnabled, promptTime: s.promptTime }).from(s)
  if (!row) return DEFAULT_SETTINGS
  return { promptEnabled: row.promptEnabled, promptTime: row.promptTime.slice(0, 5) }
}

/** A month's entries in day order (the monthly report and the stats action). */
export async function monthEntries(month: string) {
  return asViewer((tx) =>
    tx
      .select({ day: e.day, mood: e.mood, text: e.text })
      .from(e)
      .where(and(gte(e.day, `${month}-01`), lt(e.day, `${shiftMonth(month, 1)}-01`)))
      .orderBy(asc(e.day)),
  ) as Promise<{ day: string; mood: Mood | null; text: string }[]>
}

export const actions = {
  get: defineAction({
    description: "The journal entry for a day (default today): its mood from 1 (bad) to 5 (great) and its one line. Null when nothing was written.",
    kind: "read",
    input: getEntryInput,
    handler: async ({ day }): Promise<JournalEntry | null> => {
      const target = day ?? (await viewerToday())
      return asViewer((tx) => findEntry(tx, target))
    },
  }),
  upsert: defineAction({
    description:
      "Write or change a day's journal entry (default today): mood 1–5 (1 bad, 2 low, 3 okay, 4 good, 5 great; null clears it) and/or one line of text (up to 500 characters). A field left out keeps its value; a day left with neither mood nor text is removed. Returns the entry and what it was before.",
    kind: "write",
    input: upsertEntryInput,
    handler: upsertEntry,
  }),
  list: defineAction({
    description:
      "Journal entries, newest first: optionally only those whose line contains `query`, between `from` and `to` (inclusive), or before a day (for paging).",
    kind: "read",
    input: listEntriesInput,
    handler: async ({ query, from, to, before, limit }): Promise<JournalEntry[]> =>
      asViewer(async (tx) => {
        const where: SQL[] = []
        if (query) where.push(ilike(e.text, likeContains(query)))
        if (from) where.push(gte(e.day, from))
        if (to) where.push(lte(e.day, to))
        if (before) where.push(lt(e.day, before))
        const rows = await tx
          .select(columns)
          .from(e)
          .where(where.length ? and(...where) : undefined)
          .orderBy(desc(e.day))
          .limit(limit)
        return rows.map(toEntry)
      }),
  }),
  delete: defineAction({
    description: "Delete a day's journal entry. Returns what it was (null if there was none), so it can be written back.",
    kind: "write",
    input: deleteEntryInput,
    handler: async ({ day }): Promise<{ deleted: number; previous: EntrySnapshot }> =>
      asViewer(async (tx) => {
        const before = await findEntry(tx, day)
        if (!before) return { deleted: 0, previous: null }
        await tx.delete(e).where(eq(e.day, day))
        return { deleted: 1, previous: snapshot(before) }
      }),
  }),
  year: defineAction({
    description: "Every day of a year (default this year) that has a journal entry, with its mood (null if only a line was written).",
    kind: "read",
    input: yearInput,
    handler: async ({ year }): Promise<JournalYear> => {
      const today = await viewerToday()
      const y = year ?? Number(today.slice(0, 4))
      const rows = await asViewer((tx) =>
        tx
          .select({ day: e.day, mood: e.mood, text: e.text })
          .from(e)
          .where(and(gte(e.day, `${y}-01-01`), lte(e.day, `${y}-12-31`)))
          .orderBy(asc(e.day)),
      )
      return { year: y, today, days: rows.map((r) => ({ day: r.day, mood: r.mood as Mood | null, hasText: r.text !== "" })) }
    },
  }),
  stats: defineAction({
    description: "A month of the journal (YYYY-MM): days written, days with a mood and the average mood (1–5), the best and the worst day.",
    kind: "read",
    input: statsInput,
    handler: async ({ month }): Promise<JournalStats> => monthStats(month, await monthEntries(month)),
  }),
  settings: defineAction({
    description: "The Telegram evening question (\"How was today?\"): whether it's on and at what time (HH:MM).",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<JournalSettings> => asViewer(readSettings),
  }),
  updateSettings: defineAction({
    description: "Turn osbot's evening journal question on or off and set its time (HH:MM, the user's clock).",
    kind: "write",
    input: updateSettingsInput,
    handler: async (input: z.infer<typeof updateSettingsInput>): Promise<JournalSettings> =>
      asViewer(async (tx) => {
        await tx.insert(s).values(input).onConflictDoUpdate({ target: s.ownerId, set: input })
        return input
      }),
  }),
}
