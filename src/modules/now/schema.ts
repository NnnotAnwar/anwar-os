import { z } from "zod"
import { NOW_INTRO_MAX, NOW_LOCATION_MAX } from "@/db/schema/now"
import type { GoalProgress } from "@/modules/goals/schema"

export { NOW_INTRO_MAX, NOW_LOCATION_MAX }

/**
 * Cache tag for the /now page's own reads (settings, goals, habits). Dropped
 * by the owner's edits of the settings and of any goal; the page's projects
 * and notes come from their modules' cached reads, which have their own tags.
 */
export const NOW_PUBLIC_TAG = "now:public"

export const nowSettingsInput = z.object({
  intro: z.string().trim().max(NOW_INTRO_MAX, `Keep the intro under ${NOW_INTRO_MAX} characters.`),
  location: z.string().trim().max(NOW_LOCATION_MAX, `Keep the place under ${NOW_LOCATION_MAX} characters.`),
  showGoals: z.boolean(),
  showProjects: z.boolean(),
  showWriting: z.boolean(),
  showHabits: z.boolean(),
})
export type NowSettingsInput = z.infer<typeof nowSettingsInput>

/** `updatedAt` is null until the owner saves the settings once. */
export type NowSettings = NowSettingsInput & { updatedAt: string | null }

/** What /now shows before the owner has touched anything: everything but habits. */
export const defaultNowSettings: NowSettings = {
  intro: "",
  location: "",
  showGoals: true,
  showProjects: true,
  showWriting: true,
  showHabits: false,
  updatedAt: null,
}

/** One goal as the public page gets it from app.now_goals(): no "why", no task titles. */
export type NowGoal = {
  id: string
  title: string
  status: "active" | "done"
  progress: GoalProgress
  updatedAt: string
}

/** The habits line, an aggregate only (app.now_habits()). */
export type NowHabits = { habits: number; daily: number; longestStreak: number }
