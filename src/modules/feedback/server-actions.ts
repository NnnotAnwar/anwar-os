"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { actions } from "./actions"
import { feedbackIdInput, saveReplyNoteInput, setStatusInput, type FeedbackStatus } from "./schema"

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const OFFLINE = "That didn't save. Check your connection and try again."

function refresh() {
  revalidatePath("/app/feedback", "layout")
  revalidatePath("/app")
}

/** Changes the status at once; returns the previous one so the toast can undo. */
export async function setFeedbackStatus(input: {
  id: string
  status: FeedbackStatus
}): Promise<Result<FeedbackStatus | null>> {
  const parsed = setStatusInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Pick one of the listed statuses." }
  try {
    const previous = await actions.setStatus.handler(parsed.data)
    refresh()
    return { ok: true, data: previous }
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

/** Opening a new item marks it read, quietly; no revalidation mid-view. */
export async function markFeedbackRead(input: { id: string }): Promise<void> {
  const parsed = feedbackIdInput.safeParse(input)
  if (!parsed.success) return
  const item = await actions.get.handler(parsed.data)
  if (item?.status === "new") await actions.setStatus.handler({ id: item.id, status: "read" })
}

export async function saveReplyNote(input: { id: string; replyNote: string }): Promise<Result<string>> {
  const parsed = saveReplyNoteInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? OFFLINE }
  try {
    return { ok: true, data: await actions.saveReplyNote.handler(parsed.data) }
  } catch {
    return { ok: false, error: "The note wasn't saved. Check your connection; it retries on the next edit." }
  }
}

export async function deleteFeedback(input: { id: string }): Promise<void> {
  const parsed = feedbackIdInput.safeParse(input)
  if (!parsed.success) return
  await actions.delete.handler(parsed.data)
  refresh()
  redirect("/app/feedback")
}
