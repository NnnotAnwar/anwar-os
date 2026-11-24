"use server"

import { refresh } from "next/cache"
import type { z } from "zod"
import { actions, InboxInputError } from "./actions"
import { captureInput, inboxIdInput, processInput, updateInboxInput, type InboxItem, type ProcessResult } from "./schema"

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
    refresh()
    return { ok: true, value }
  } catch (error) {
    if (error instanceof InboxInputError) return { ok: false, error: error.message }
    // Another module's validation (e.g. a title that's too long) explains itself.
    if (error && typeof error === "object" && "issues" in error) {
      const issues = (error as { issues: { message: string }[] }).issues
      if (issues[0]?.message) return { ok: false, error: issues[0].message }
    }
    console.error("inbox action failed", error)
    return { ok: false, error: fallback }
  }
}

/**
 * Capture anything into the signed-in viewer's inbox. The one entry point for
 * other features: the global capture sheet, the PWA share target, and later
 * the Telegram bot (through a route that signs in as the owner).
 */
export async function captureToInbox(input: { id?: string; text: string; url?: string | null; source?: InboxItem["source"] }): Promise<Result<InboxItem>> {
  return run(captureInput, input, (d) => actions.capture.handler(d), "That wasn't captured. Check your connection and try again.")
}

export async function processInboxItem(input: unknown): Promise<Result<ProcessResult>> {
  return run(processInput, input, (d) => actions.process.handler(d), "That item wasn't processed. Try again.")
}

export async function unprocessInboxItem(input: unknown) {
  return run(inboxIdInput, input, (d) => actions.unprocess.handler(d), "Undo didn't work. Try again.")
}

export async function updateInboxItem(input: unknown) {
  return run(updateInboxInput, input, (d) => actions.update.handler(d), "Changes weren't saved. Try again.")
}

export async function deleteInboxItem(input: unknown) {
  return run(inboxIdInput, input, (d) => actions.delete.handler(d), "The item wasn't deleted. Try again.")
}
