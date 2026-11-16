"use server"

import { updateTag } from "next/cache"
import { actions } from "./actions"
import { entryRefInput, moveEntryInput, profileInput, PUBLIC_CV_TAG, saveEntryInput, type EntryKind } from "./schema"

// Each save drops the public CV cache so /cv shows the edit on the next load.
// The editor owns its state while open, so nothing here re-renders /app/cv.

export type CvSaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string }

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the fields and try again."
}

const offline = "Changes weren't saved. Check your connection; they retry on the next edit."

export async function saveCvProfile(input: unknown): Promise<CvSaveResult> {
  const parsed = profileInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const { updatedAt } = await actions.saveProfile.handler(parsed.data)
    updateTag(PUBLIC_CV_TAG)
    return { ok: true, id: "profile", updatedAt }
  } catch {
    return { ok: false, error: offline }
  }
}

export async function saveCvEntry(kind: EntryKind, id: string | null, fields: unknown): Promise<CvSaveResult> {
  const parsed = saveEntryInput.safeParse({ kind, id, fields })
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const saved = await actions.saveEntry.handler(parsed.data)
    updateTag(PUBLIC_CV_TAG)
    return { ok: true, ...saved }
  } catch {
    return { ok: false, error: offline }
  }
}

export async function moveCvEntry(input: { kind: EntryKind; id: string; direction: "up" | "down" }) {
  const parsed = moveEntryInput.safeParse(input)
  if (!parsed.success) return
  await actions.moveEntry.handler(parsed.data)
  updateTag(PUBLIC_CV_TAG)
}

export async function deleteCvEntry(input: { kind: EntryKind; id: string }) {
  const parsed = entryRefInput.safeParse(input)
  if (!parsed.success) return
  await actions.deleteEntry.handler(parsed.data)
  updateTag(PUBLIC_CV_TAG)
}
