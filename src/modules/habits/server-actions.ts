"use server"

import { refresh } from "next/cache"
import type { z } from "zod"
import { actions, HabitInputError } from "./actions"
import {
  archiveHabitInput,
  checkHabitInput,
  createHabitInput,
  habitIdInput,
  updateHabitInput,
  updateSettingsInput,
  type Habit,
  type HabitsSettings,
  type ToggleResult,
} from "./schema"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
  fallback: string,
): Promise<Result<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? fallback }
  try {
    const value = await fn(parsed.data)
    // Re-render whatever page called this (Habits, one habit, or Today's widget).
    refresh()
    return { ok: true, value }
  } catch (error) {
    if (error instanceof HabitInputError) return { ok: false, error: error.message }
    console.error("habits action failed", error)
    return { ok: false, error: fallback }
  }
}

export async function createHabit(input: unknown): Promise<Result<Habit>> {
  return run(createHabitInput, input, (d) => actions.create.handler(d), "The habit wasn't added. Try again.")
}

export async function updateHabit(input: unknown): Promise<Result<Habit>> {
  return run(updateHabitInput, input, (d) => actions.update.handler(d), "Changes weren't saved. Try again.")
}

export async function archiveHabit(input: unknown): Promise<Result<Habit>> {
  return run(archiveHabitInput, input, (d) => actions.archive.handler(d), "The habit wasn't changed. Try again.")
}

export async function deleteHabit(input: unknown) {
  return run(habitIdInput, input, (d) => actions.delete.handler(d), "The habit wasn't deleted. Try again.")
}

export async function toggleHabit(input: unknown): Promise<Result<ToggleResult>> {
  return run(checkHabitInput, input, (d) => actions.toggle.handler(d), "That didn't save. Check your connection and try again.")
}

export async function updateHabitsSettings(input: unknown): Promise<Result<HabitsSettings>> {
  return run(updateSettingsInput, input, (d) => actions.updateSettings.handler(d), "The reminder wasn't saved. Try again.")
}
