"use server"

import { revalidatePath, updateTag } from "next/cache"
import { redirect } from "next/navigation"
import { actions } from "./actions"
import {
  createIdeaInput,
  ideaIdInput,
  PUBLIC_IDEAS_TAG,
  setIdeaPublicInput,
  setIdeaStatusInput,
  updateIdeaInput,
  type IdeaStatus,
} from "./schema"

export type IdeaSaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string }

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the idea and try again."
}

/** Drops the public cache; the private board re-renders on the same response. */
function changed() {
  updateTag(PUBLIC_IDEAS_TAG)
  revalidatePath("/app/ideas")
}

/** Quick add from the board: a title, nothing else. */
export async function quickAddIdea(title: string): Promise<IdeaSaveResult> {
  const parsed = createIdeaInput.safeParse({ title })
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const created = await actions.create.handler(parsed.data)
    changed()
    return { ok: true, ...created }
  } catch {
    return { ok: false, error: "The idea wasn't added. Check your connection and try again." }
  }
}

/** The detail editor's autosave: creates on the first save (id null), then updates. */
export async function saveIdea(id: string | null, input: unknown): Promise<IdeaSaveResult> {
  try {
    if (!id) {
      const parsed = createIdeaInput.safeParse(input)
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
      const created = await actions.create.handler(parsed.data)
      updateTag(PUBLIC_IDEAS_TAG)
      return { ok: true, ...created }
    }
    const parsed = updateIdeaInput.safeParse({ ...(input as object), id })
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
    const { updatedAt } = await actions.update.handler(parsed.data)
    updateTag(PUBLIC_IDEAS_TAG)
    return { ok: true, id, updatedAt }
  } catch {
    return { ok: false, error: "Changes weren't saved. Check your connection; they retry on the next edit." }
  }
}

export async function setIdeaStatus(input: { id: string; status: IdeaStatus }) {
  const parsed = setIdeaStatusInput.safeParse(input)
  if (!parsed.success) return
  await actions.setStatus.handler(parsed.data)
  changed()
}

export async function setIdeaPublic(input: { id: string; value: boolean }) {
  const parsed = setIdeaPublicInput.safeParse(input)
  if (!parsed.success) return
  await actions.setPublic.handler(parsed.data)
  changed()
}

/** Called when the Undo toast expires, so a mistaken delete costs nothing. */
export async function deleteIdea(input: { id: string }) {
  const parsed = ideaIdInput.safeParse(input)
  if (!parsed.success) return
  await actions.delete.handler(parsed.data)
  changed()
}

/** From the detail page: delete and go back to the board. */
export async function deleteIdeaAndReturn(input: { id: string }) {
  await deleteIdea(input)
  revalidatePath("/app", "layout")
  redirect("/app/ideas")
}
