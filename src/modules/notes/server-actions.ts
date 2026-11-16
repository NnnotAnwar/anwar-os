"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { actions } from "./actions"
import { createNoteInput, noteIdInput, setPinnedInput, updateNoteInput } from "./schema"

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

export async function deleteNote(input: { id: string }): Promise<void> {
  const parsed = noteIdInput.safeParse(input)
  if (!parsed.success) return
  await actions.delete.handler(parsed.data)
  revalidatePath("/app", "layout")
  redirect("/app/notes")
}
