import "server-only"
import { and, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { habitsHabits as h, habitsSettings as s } from "@/db/schema"
import { formatIsoDate, wallClock } from "@/modules/calendar/lib/zoned"
import { actions, habitsOn, HabitInputError, readSettings } from "./actions"
import { isScheduled } from "./lib/days"
import { formatDayLabel } from "./lib/format"
import type { TodayHabit } from "./schema"

// What osbot needs from habits: the /habits card (a day's habits with a toggle
// per habit) and the scheduled nudges (a habit's own reminder time, and the
// evening list of what's still open). Runs inside actAs(owner) (the osbot API
// wrapper), so RLS scopes everything to the owner.

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-24.")

function ownerClock(timezone: string, now: Date) {
  const w = wallClock(now, timezone)
  const today = formatIsoDate({ year: w.year, month: w.month, day: w.day })
  const time = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`
  return { today, time }
}

export type HabitsCard = {
  date: string
  today: string
  /** "Tuesday 24 Nov". */
  label: string
  habits: TodayHabit[]
  done: number
  total: number
  url: string
}

export const habitsCardInput = z.object({ date: isoDate.optional() })

/** The /habits card: the habits scheduled on `date` (default the owner's today). */
export async function habitsCard({ date }: z.infer<typeof habitsCardInput>, timezone: string, now = new Date()): Promise<HabitsCard> {
  const { today } = ownerClock(timezone, now)
  const day = await habitsOn(date ?? today, today)
  return {
    date: day.date,
    today,
    label: formatDayLabel(day.date),
    habits: day.habits,
    done: day.habits.filter((habit) => habit.done).length,
    total: day.habits.length,
    url: `${baseUrl()}/app/habits`,
  }
}

export const toggleInput = z.object({ id: z.uuid(), date: isoDate.optional() })

/** Flips one habit for a day, then returns that day's card so the bot can redraw it. */
export async function toggleFromBot(input: z.infer<typeof toggleInput>, timezone: string) {
  const result = await actions.toggle.handler(input)
  const card = await habitsCard({ date: result.date }, timezone)
  const habit = card.habits.find((x) => x.id === input.id)
  return { toggled: { id: input.id, done: result.done, name: habit?.name ?? "" }, ...card }
}

export { HabitInputError }

export type HabitReminder = { id: string; name: string; emoji: string; time: string }
export type HabitNudges = {
  date: string
  /** Habits whose own reminder time has come today and that aren't done (nor reminded) yet. */
  reminders: HabitReminder[]
  /** The evening list, once its time has come, while something is still open. */
  evening: { time: string; habits: TodayHabit[] } | null
  url: string
}

/** What osbot should send now, in the owner's clock. Nothing is marked sent until nudges/ack. */
export async function nudgesDue(timezone: string, now = new Date()): Promise<HabitNudges> {
  const { today, time } = ownerClock(timezone, now)
  const day = await habitsOn(today, today)
  const open = day.habits.filter((habit) => !habit.done)
  const openIds = new Set(open.map((habit) => habit.id))
  const { rows, settings } = await asViewer(async (tx) => ({
    rows: await tx
      .select({ id: h.id, name: h.name, emoji: h.emoji, weekdays: h.weekdays, reminderTime: h.reminderTime, lastRemindedOn: h.lastRemindedOn })
      .from(h)
      .where(isNull(h.archivedAt)),
    settings: await readSettings(tx),
  }))
  const reminders = rows
    .filter((row) => row.reminderTime && openIds.has(row.id) && isScheduled(row.weekdays, today))
    .map((row) => ({ ...row, time: row.reminderTime!.slice(0, 5) }))
    .filter((row) => row.time <= time && row.lastRemindedOn !== today)
    .sort((a, b) => a.time.localeCompare(b.time))
    .map(({ id, name, emoji, time }) => ({ id, name, emoji, time }))
  const eveningDue = settings.nudgeEnabled && settings.nudgeTime <= time && settings.lastNudgedOn !== today && open.length > 0
  return {
    date: today,
    reminders,
    evening: eveningDue ? { time: settings.nudgeTime, habits: open } : null,
    url: `${baseUrl()}/app/habits`,
  }
}

export const ackNudgesInput = z.object({
  date: isoDate,
  reminders: z.array(z.uuid()).max(200).default([]),
  evening: z.boolean().default(false),
})

/** Records what osbot sent for `date`, so it goes out once. */
export async function ackNudges({ date, reminders, evening }: z.infer<typeof ackNudgesInput>) {
  return asViewer(async (tx) => {
    let acked = 0
    if (reminders.length) {
      const updated = await tx
        .update(h)
        .set({ lastRemindedOn: date })
        .where(and(inArray(h.id, reminders), isNull(h.archivedAt)))
        .returning({ id: h.id })
      acked += updated.length
    }
    if (evening) {
      await tx.insert(s).values({ lastNudgedOn: date }).onConflictDoUpdate({ target: s.ownerId, set: { lastNudgedOn: date } })
      acked += 1
    }
    return { acked }
  })
}
