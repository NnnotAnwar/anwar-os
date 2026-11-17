"use server"

import { revalidatePath } from "next/cache"
import { actions } from "./actions"
import { createNoteInput, noteIdsInput, pinNotesInput, setPinnedInput, updateNoteInput } from "./schema"

// Autosave and pinning don't revalidate: the editor owns its state while open, and
// the list and dashboard render per request, so they're fresh on the next visit.
// Re-rendering the route mid-typing would only risk remounting the editor.

export type SaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string }

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the note and try again."
}

/** Creates without navigating: the editor swaps its URL in place and keeps typing. */
export async function createNote(input: { title: string; body: string }): Promise<SaveResult> {
  const parsed = createNoteInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  try {
    const { id, updatedAt } = await actions.create.handler(parsed.data)
    return { ok: true, id, updatedAt }
  } catch {
    return { ok: false, error: "The note wasn't created. Check your connection; it retries on the next edit." }
  }
}

export async function saveNote(input: { id: string; title: string; body: string }): Promise<SaveResult> {
  const parsed = updateNoteInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  try {
    const { updated_at } = await actions.update.handler(parsed.data)
    return { ok: true, id: parsed.data.id, updatedAt: updated_at }
  } catch {
    return { ok: false, error: "Changes weren't saved. Check your connection; they'll retry on the next edit." }
  }
}

export async function setNotePinned(input: { id: string; pinned: boolean }): Promise<void> {
  const parsed = setPinnedInput.safeParse(input)
  if (!parsed.success) return
  await actions.setPinned.handler(parsed.data)
}

export type BulkResult = { ok: true } | { ok: false; error: string }

/** Pins or unpins several notes at once (the list's swipe, menu and bulk bar). */
export async function pinNotes(input: { ids: string[]; pinned: boolean }): Promise<BulkResult> {
  const parsed = pinNotesInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    for (const id of parsed.data.ids) await actions.setPinned.handler({ id, pinned: parsed.data.pinned })
    revalidatePath("/app", "layout")
    return { ok: true }
  } catch {
    return { ok: false, error: "That didn't save. Check your connection and try again." }
  }
}

/**
 * Deletes for good. Runs when the Undo toast expires, so a mistaken delete
 * costs nothing; it never navigates, the page that asked has moved on already.
 */
export async function deleteNotes(input: { ids: string[] }): Promise<BulkResult> {
  const parsed = noteIdsInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    for (const id of parsed.data.ids) await actions.delete.handler({ id })
    revalidatePath("/app", "layout")
    return { ok: true }
  } catch {
    return { ok: false, error: "The note wasn't deleted. Check your connection and try again." }
  }
}
