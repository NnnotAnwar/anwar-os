import { z } from "zod"
import { EVERY_DAY } from "./lib/days"

export { EVERY_DAY }

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-24.")
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 21:00.")

export const habitFields = {
  name: z.string().trim().min(1, "Give the habit a name.").max(80, "Keep the name under 80 characters."),
  emoji: z.string().trim().max(16, "One emoji is enough."),
  weekdays: z.number().int().min(1, "Pick at least one day.").max(EVERY_DAY),
  reminderTime: clockTime.nullable(),
}

export const createHabitInput = z.object({
  name: habitFields.name,
  emoji: habitFields.emoji.default(""),
  weekdays: habitFields.weekdays.default(EVERY_DAY),
  reminderTime: habitFields.reminderTime.default(null),
})
export const updateHabitInput = z.object({ id: z.uuid(), ...habitFields })
export const habitIdInput = z.object({ id: z.uuid() })
export const archiveHabitInput = z.object({ id: z.uuid(), archived: z.boolean() })
/** `date` defaults to the user's today; past days (up to a year) can be fixed too, never the future. */
export const checkHabitInput = z.object({ id: z.uuid(), date: isoDate.optional() })
export const overviewInput = z.object({ includeArchived: z.boolean().default(false) })
export const todayInput = z.object({ date: isoDate.optional() })
export const getHabitInput = z.object({ id: z.uuid(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() })
export const searchHabitsInput = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(10),
})
export const reorderHabitsInput = z.object({ ids: z.array(z.uuid()).min(1).max(200) })
export const updateSettingsInput = z.object({ nudgeEnabled: z.boolean(), nudgeTime: clockTime })

export type Habit = {
  id: string
  name: string
  emoji: string
  /** Bit mask, Monday = bit 0 … Sunday = bit 6. */
  weekdays: number
  /** "HH:MM" or null. */
  reminderTime: string | null
  archived: boolean
  createdAt: string
}

export type DayMark = { day: string; scheduled: boolean; done: boolean }

export type HabitSummary = Habit & {
  scheduledToday: boolean
  doneToday: boolean
  /** Consecutive scheduled days done, up to today (an unchecked today doesn't break it yet). */
  current: number
  best: number
  /** The last 30 days, oldest first, ending today. */
  recent: DayMark[]
}

export type HabitsOverview = { today: string; habits: HabitSummary[]; archived: Habit[] }

/** One of the day's scheduled habits, for the Today widget and osbot. */
export type TodayHabit = { id: string; name: string; emoji: string; done: boolean; current: number }
export type HabitsDay = { date: string; habits: TodayHabit[] }

export type MonthDay = DayMark & { future: boolean }

export type HabitDetail = {
  today: string
  habit: HabitSummary
  month: string
  /** Every day of `month`. */
  days: MonthDay[]
  monthDone: number
  monthScheduled: number
  totalDone: number
}

export type HabitsSettings = { nudgeEnabled: boolean; nudgeTime: string }

export type ToggleResult = { id: string; date: string; done: boolean; current: number }
