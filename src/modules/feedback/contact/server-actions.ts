"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { actions } from "../actions"
import { contactIdInput, setContactStatusInput, type ContactStatus } from "./schema"

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

function refresh() {
  revalidatePath("/app/feedback", "layout")
  revalidatePath("/app")
}

/** Changes the status at once; returns the previous one so the toast can undo. */
export async function setContactStatus(input: { id: string; status: ContactStatus }): Promise<Result<ContactStatus>> {
  const parsed = setContactStatusInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Pick one of the listed statuses." }
  try {
    const previous = await actions.contactSetStatus.handler(parsed.data)
    if (previous === null) return { ok: false, error: "This message no longer exists." }
    refresh()
    return { ok: true, data: previous }
  } catch {
    return { ok: false, error: "That didn't save. Check your connection and try again." }
  }
}

export async function deleteContact(input: { id: string }): Promise<void> {
  const parsed = contactIdInput.safeParse(input)
  if (!parsed.success) return
  await actions.contactDelete.handler(parsed.data)
  refresh()
  redirect("/app/feedback/contact")
}
