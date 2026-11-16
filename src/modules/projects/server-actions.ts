"use server"

import { revalidatePath, updateTag } from "next/cache"
import { redirect } from "next/navigation"
import { slugify } from "@/lib/tags"
import { actions, SlugTakenError } from "./actions"
import {
  moveProjectInput,
  PUBLIC_PROJECTS_TAG,
  projectIdInput,
  projectInput,
  setProjectFlagInput,
} from "./schema"

// Every write drops the public cache (grid, case studies, landing) right away,
// so the owner sees an edit on the public site on the next load.

export type ProjectSaveResult =
  | { ok: true; id: string; slug: string; updatedAt: string }
  | { ok: false; error: string }

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the project and try again."
}

/** Creates the project on the first save (id null), then updates it. */
export async function saveProject(id: string | null, input: unknown): Promise<ProjectSaveResult> {
  const raw = (input ?? {}) as Record<string, unknown>
  // Until the owner types an address, derive it from the title.
  const withSlug = { ...raw, slug: raw.slug || slugify(String(raw.title ?? "")) || "project" }
  const parsed = projectInput.safeParse(withSlug)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  try {
    if (!id) {
      const created = await actions.create.handler(parsed.data)
      updateTag(PUBLIC_PROJECTS_TAG)
      return { ok: true, ...created }
    }
    const { updatedAt } = await actions.update.handler({ id, ...parsed.data })
    updateTag(PUBLIC_PROJECTS_TAG)
    return { ok: true, id, slug: parsed.data.slug, updatedAt }
  } catch (error) {
    if (error instanceof SlugTakenError) return { ok: false, error: error.message }
    return { ok: false, error: "Changes weren't saved. Check your connection; they retry on the next edit." }
  }
}

export async function setProjectPublished(input: { id: string; value: boolean }) {
  const parsed = setProjectFlagInput.safeParse(input)
  if (!parsed.success) return
  await actions.setPublished.handler(parsed.data)
  updateTag(PUBLIC_PROJECTS_TAG)
  revalidatePath("/app/projects")
}

export async function moveProject(input: { id: string; direction: "up" | "down" }) {
  const parsed = moveProjectInput.safeParse(input)
  if (!parsed.success) return
  await actions.move.handler(parsed.data)
  updateTag(PUBLIC_PROJECTS_TAG)
  revalidatePath("/app/projects")
}

export async function deleteProject(input: { id: string }) {
  const parsed = projectIdInput.safeParse(input)
  if (!parsed.success) return
  await actions.delete.handler(parsed.data)
  updateTag(PUBLIC_PROJECTS_TAG)
  revalidatePath("/app", "layout")
  redirect("/app/projects")
}
