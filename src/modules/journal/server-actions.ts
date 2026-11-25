"use server"

import { refresh } from "next/cache"
import type { z } from "zod"
import { actions, JournalInputError, upsertEntry } from "./actions"
import { deleteEntryInput, updateSettingsInput, upsertEntryInput, type EntrySnapshot, type JournalSettings, type UpsertResult } from "./schema"

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
    // Re-render whatever page called this (Journal or Today's widget).
    refresh()
    return { ok: true, value }
  } catch (error) {
    if (error instanceof JournalInputError) return { ok: false, error: error.message }
    console.error("journal action failed", error)
    return { ok: false, error: fallback }
  }
}

/** Sets a day's mood and/or line; also how Undo writes the previous version back. */
export async function saveJournalEntry(input: unknown): Promise<Result<UpsertResult>> {
  return run(upsertEntryInput, input, upsertEntry, "That didn't save. Check your connection and try again.")
}

export async function deleteJournalEntry(input: unknown): Promise<Result<{ deleted: number; previous: EntrySnapshot }>> {
  return run(deleteEntryInput, input, (d) => actions.delete.handler(d), "The entry wasn't deleted. Try again.")
}

export async function updateJournalSettings(input: unknown): Promise<Result<JournalSettings>> {
  return run(updateSettingsInput, input, (d) => actions.updateSettings.handler(d), "The setting wasn't saved. Try again.")
}
