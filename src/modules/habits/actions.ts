import "server-only"
import { droppingPublicCache } from "@/core/public-cache"
import { NOW_PUBLIC_TAG } from "@/modules/now/schema"
import { and, asc, eq, ilike, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { habitsChecks as c, habitsHabits as h, habitsSettings as s } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { formatIsoDate, wallClock } from "@/modules/calendar/lib/zoned"
import { daysBetween, daysOfMonth, isScheduled } from "./lib/days"
import { bestStreak, currentStreak, recentDays } from "./lib/streak"
import {
  archiveHabitInput,
  checkHabitInput,
  createHabitInput,
  getHabitInput,
  habitIdInput,
  overviewInput,
  reorderHabitsInput,
  searchHabitsInput,
  todayInput,
  updateHabitInput,
  updateSettingsInput,
  type Habit,
  type HabitDetail,
  type HabitsDay,
  type HabitsOverview,
  type HabitsSettings,
  type HabitSummary,
  type ToggleResult,
} from "./schema"

/** A message the UI and the bot can show as is (missing habit, a future day…). */
export class HabitInputError extends Error {}

/** How far back a forgotten day can still be checked. */
const BACKFILL_DAYS = 366
const DEFAULT_SETTINGS: HabitsSettings = { nudgeEnabled: false, nudgeTime: "21:00" }

const columns = {
  id: h.id,
  name: h.name,
  emoji: h.emoji,
  weekdays: h.weekdays,
  reminderTime: h.reminderTime,
  archivedAt: h.archivedAt,
  createdAt: h.createdAt,
}

type Row = { id: string; name: string; emoji: string; weekdays: number; reminderTime: string | null; archivedAt: Date | null; createdAt: Date }

function toHabit(row: Row): Habit {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    weekdays: row.weekdays,
    reminderTime: row.reminderTime ? row.reminderTime.slice(0, 5) : null,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The viewer's calendar date: "today" depends on their zone, not the server's. */
export async function viewerToday() {
  // The session first: reading the clock before any request data breaks prerendering.
  const viewer = await requireViewer()
  const w = wallClock(new Date(), viewer.timezone)
  return formatIsoDate({ year: w.year, month: w.month, day: w.day })
}

/** Checked days per habit, for the given habits (all of their history). */
async function checksByHabit(tx: Tx, ids: string[]) {
  const map = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]))
  if (!ids.length) return map
  const rows = await tx.select({ habitId: c.habitId, day: c.day }).from(c).where(inArray(c.habitId, ids))
  for (const row of rows) map.get(row.habitId)?.add(row.day)
  return map
}

function summarize(habit: Habit, done: ReadonlySet<string>, today: string): HabitSummary {
  return {
    ...habit,
    scheduledToday: isScheduled(habit.weekdays, today),
    doneToday: done.has(today),
    current: currentStreak(habit.weekdays, done, today),
    best: bestStreak(habit.weekdays, done, today),
    recent: recentDays(habit.weekdays, done, today),
  }
}

async function activeHabits(tx: Tx) {
  const rows = await tx.select(columns).from(h).where(isNull(h.archivedAt)).orderBy(asc(h.sortOrder), asc(h.createdAt))
  return rows.map(toHabit)
}

async function findHabit(tx: Tx, id: string) {
  const [row] = await tx.select(columns).from(h).where(eq(h.id, id))
  return row ? toHabit(row) : null
}

/** Validates the day a check is for: today by default, past days within a year, never the future. */
async function checkDay(date: string | undefined) {
  const today = await viewerToday()
  const day = date ?? today
  if (day > today) throw new HabitInputError("You can't check a habit for a day that hasn't come yet.")
  if (daysBetween(day, today) > BACKFILL_DAYS) throw new HabitInputError("That day is too long ago to change.")
  return { day, today }
}

async function setCheck(id: string, date: string | undefined, want: boolean | "toggle"): Promise<ToggleResult> {
  const { day, today } = await checkDay(date)
  return asViewer(async (tx) => {
    const habit = await findHabit(tx, id)
    if (!habit) throw new HabitInputError("That habit doesn't exist anymore.")
    if (habit.archived) throw new HabitInputError("This habit is archived. Restore it to check it off.")
    const [existing] = await tx.select({ id: c.id }).from(c).where(and(eq(c.habitId, id), eq(c.day, day)))
    const done = want === "toggle" ? !existing : want
    if (done && !existing) {
      await tx.insert(c).values({ habitId: id, day }).onConflictDoNothing({ target: [c.habitId, c.day] })
    } else if (!done && existing) {
      await tx.delete(c).where(eq(c.id, existing.id))
    }
    const checks = (await checksByHabit(tx, [id])).get(id)!
    return { id, date: day, done, current: currentStreak(habit.weekdays, checks, today) }
  })
}

/** The habits scheduled on `date`, with whether each is done and its streak (for Today and osbot). */
export async function habitsOn(date: string, today: string): Promise<HabitsDay> {
  return asViewer(async (tx) => {
    const habits = (await activeHabits(tx)).filter((habit) => isScheduled(habit.weekdays, date))
    const checks = await checksByHabit(tx, habits.map((habit) => habit.id))
    return {
      date,
      habits: habits.map((habit) => {
        const done = checks.get(habit.id)!
        return { id: habit.id, name: habit.name, emoji: habit.emoji, done: done.has(date), current: currentStreak(habit.weekdays, done, today) }
      }),
    }
  })
}

export async function readSettings(tx: Tx): Promise<HabitsSettings & { lastNudgedOn: string | null }> {
  const [row] = await tx.select({ nudgeEnabled: s.nudgeEnabled, nudgeTime: s.nudgeTime, lastNudgedOn: s.lastNudgedOn }).from(s)
  if (!row) return { ...DEFAULT_SETTINGS, lastNudgedOn: null }
  return { nudgeEnabled: row.nudgeEnabled, nudgeTime: row.nudgeTime.slice(0, 5), lastNudgedOn: row.lastNudgedOn }
}

export const actions = droppingPublicCache([NOW_PUBLIC_TAG], {
  overview: defineAction({
    description:
      "The user's habits with today's state: whether each is scheduled and done today, its current and best streak (in scheduled days) and the last 30 days. Optionally also the archived habits.",
    kind: "read",
    input: overviewInput,
    handler: async ({ includeArchived }): Promise<HabitsOverview> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const habits = await activeHabits(tx)
        const checks = await checksByHabit(tx, habits.map((habit) => habit.id))
        const archived = includeArchived
          ? (await tx.select(columns).from(h).where(isNotNull(h.archivedAt)).orderBy(asc(h.name))).map(toHabit)
          : []
        return { today, habits: habits.map((habit) => summarize(habit, checks.get(habit.id)!, today)), archived }
      })
    },
  }),
  today: defineAction({
    description: "The habits scheduled for a day (default today), each with whether it's done and its current streak.",
    kind: "read",
    input: todayInput,
    handler: async ({ date }) => {
      const today = await viewerToday()
      return habitsOn(date ?? today, today)
    },
  }),
  get: defineAction({
    description:
      "One habit with its streaks and a month of days (YYYY-MM, default this month): scheduled, done, in the future. Returns null if it doesn't exist.",
    kind: "read",
    input: getHabitInput,
    handler: async ({ id, month }): Promise<HabitDetail | null> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const habit = await findHabit(tx, id)
        if (!habit) return null
        const done = (await checksByHabit(tx, [id])).get(id)!
        const shown = month ?? today.slice(0, 7)
        const days = daysOfMonth(shown).map((day) => ({
          day,
          scheduled: isScheduled(habit.weekdays, day),
          done: done.has(day),
          future: day > today,
        }))
        const counted = days.filter((d) => d.scheduled && !d.future)
        return {
          today,
          habit: summarize(habit, done, today),
          month: shown,
          days,
          monthDone: counted.filter((d) => d.done).length,
          monthScheduled: counted.length,
          totalDone: done.size,
        }
      })
    },
  }),
  search: defineAction({
    description: "Find habits (active and archived) whose name contains the text.",
    kind: "read",
    input: searchHabitsInput,
    handler: async ({ query, limit }) =>
      asViewer(async (tx) => {
        const rows = await tx
          .select(columns)
          .from(h)
          .where(ilike(h.name, likeContains(query)))
          .orderBy(sql`${h.archivedAt} is not null`, asc(h.sortOrder))
          .limit(limit)
        return rows.map(toHabit)
      }),
  }),
  create: defineAction({
    description:
      "Create a habit: a name, an optional emoji, the weekdays it's for as a bit mask (Monday = 1, Tuesday = 2, … Sunday = 64; 127 = every day, 31 = weekdays) and an optional daily Telegram reminder time (HH:MM).",
    kind: "write",
    input: createHabitInput,
    handler: async (input): Promise<Habit> =>
      asViewer(async (tx) => {
        const [max] = await tx.select({ max: sql<number>`coalesce(max(${h.sortOrder}), 0)` }).from(h)
        const [row] = await tx
          .insert(h)
          .values({ ...input, sortOrder: Number(max?.max ?? 0) + 1 })
          .returning(columns)
        return toHabit(row!)
      }),
  }),
  update: defineAction({
    description: "Change a habit's name, emoji, weekdays (bit mask, Monday = 1 … Sunday = 64) and reminder time (HH:MM or null).",
    kind: "write",
    input: updateHabitInput,
    handler: async ({ id, ...fields }): Promise<Habit> =>
      asViewer(async (tx) => {
        const [row] = await tx.update(h).set(fields).where(eq(h.id, id)).returning(columns)
        if (!row) throw new HabitInputError("That habit doesn't exist anymore.")
        return toHabit(row)
      }),
  }),
  archive: defineAction({
    description: "Archive a habit (hide it, keep its history) or restore an archived one.",
    kind: "write",
    input: archiveHabitInput,
    handler: async ({ id, archived }): Promise<Habit> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .update(h)
          .set({ archivedAt: archived ? sql`now()` : null })
          .where(eq(h.id, id))
          .returning(columns)
        if (!row) throw new HabitInputError("That habit doesn't exist anymore.")
        return toHabit(row)
      }),
  }),
  delete: defineAction({
    description: "Permanently delete a habit and its whole history.",
    kind: "write",
    input: habitIdInput,
    handler: async ({ id }) =>
      asViewer(async (tx) => {
        const deleted = await tx.delete(h).where(eq(h.id, id)).returning({ id: h.id })
        return { deleted: deleted.length }
      }),
  }),
  check: defineAction({
    description: "Mark a habit done for a day (default today; past days within a year are allowed). Repeating it changes nothing.",
    kind: "write",
    input: checkHabitInput,
    handler: async ({ id, date }) => setCheck(id, date, true),
  }),
  uncheck: defineAction({
    description: "Mark a habit not done for a day (default today).",
    kind: "write",
    input: checkHabitInput,
    handler: async ({ id, date }) => setCheck(id, date, false),
  }),
  toggle: defineAction({
    description: "Flip a habit between done and not done for a day (default today).",
    kind: "write",
    input: checkHabitInput,
    handler: async ({ id, date }) => setCheck(id, date, "toggle"),
  }),
  reorder: defineAction({
    description: "Put the habits in the given order.",
    kind: "write",
    input: reorderHabitsInput,
    handler: async ({ ids }) =>
      asViewer(async (tx) => {
        for (const [i, id] of ids.entries()) await tx.update(h).set({ sortOrder: i + 1 }).where(eq(h.id, id))
        return { ok: true }
      }),
  }),
  settings: defineAction({
    description: "The Telegram evening nudge for habits: whether it's on and at what time (HH:MM).",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<HabitsSettings> =>
      asViewer(async (tx) => {
        const { nudgeEnabled, nudgeTime } = await readSettings(tx)
        return { nudgeEnabled, nudgeTime }
      }),
  }),
  updateSettings: defineAction({
    description: "Turn the Telegram evening nudge (a list of habits still open today) on or off and set its time (HH:MM).",
    kind: "write",
    input: updateSettingsInput,
    handler: async (input: z.infer<typeof updateSettingsInput>): Promise<HabitsSettings> =>
      asViewer(async (tx) => {
        await tx
          .insert(s)
          .values(input)
          .onConflictDoUpdate({ target: s.ownerId, set: input })
        return input
      }),
  }),
})
