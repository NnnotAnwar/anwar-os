"use server"

import { revalidatePath } from "next/cache"
import { actions } from "./actions"
import {
  createLinkInput,
  linkIdInput,
  linkIdsInput,
  restoreLinkInput,
  setLinkFlagsInput,
  setLinksFlagsInput,
  updateLinkInput,
  type Link,
} from "./schema"

/** Read later / public for several links (swipe, menu, keys and the bulk bar). */
export async function setLinksFlags(input: { ids: string[]; isPublic?: boolean; readLater?: boolean }): Promise<Result> {
  const parsed = setLinksFlagsInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const { ids, ...flags } = parsed.data
  try {
    for (const id of ids) await actions.setFlags.handler({ id, ...flags })
    refresh()
    return { ok: true, data: undefined }
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

/** Runs when the Undo toast expires: the list already hid these links. */
export async function deleteLinks(input: { ids: string[] }): Promise<Result> {
  const parsed = linkIdsInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    for (const id of parsed.data.ids) await actions.delete.handler({ id })
    refresh()
    return { ok: true, data: undefined }
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the link and try again."
}

const OFFLINE = "That didn't save. Check your connection and try again."

function refresh() {
  revalidatePath("/app/links", "layout")
  revalidatePath("/app")
  revalidatePath("/links")
}

export async function addLink(input: {
  url: string
  readLater?: boolean
}): Promise<Result<{ id: string; duplicate: boolean; fetched: boolean; title: string }>> {
  const parsed = createLinkInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const data = await actions.create.handler(parsed.data)
    refresh()
    return { ok: true, data }
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

export async function updateLink(input: {
  id: string
  url: string
  title: string
  description: string
  tags: string
  note: string
  isPublic: boolean
  readLater: boolean
}): Promise<Result<Link>> {
  const parsed = updateLinkInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const data = await actions.update.handler(parsed.data)
    refresh()
    return { ok: true, data }
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code
    if (code === "23505") return { ok: false, error: "You already saved this URL in another link. Change the URL or delete the other one." }
    return { ok: false, error: OFFLINE }
  }
}

export async function setLinkFlags(input: { id: string; isPublic?: boolean; readLater?: boolean }): Promise<Result> {
  const parsed = setLinkFlagsInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    await actions.setFlags.handler(parsed.data)
    refresh()
    return { ok: true, data: undefined }
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

export async function refetchLink(input: { id: string }): Promise<Result<Link>> {
  const parsed = linkIdInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const data = await actions.refreshMetadata.handler(parsed.data)
    if (!data) return { ok: false, error: "The page didn't answer with a title. Check the URL or type the title yourself." }
    refresh()
    return { ok: true, data }
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

/** Deletes at once and hands back the link, so the toast can offer Undo. */
export async function deleteLink(input: { id: string }): Promise<Result<Link | null>> {
  const parsed = linkIdInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const data = await actions.delete.handler(parsed.data)
    refresh()
    return { ok: true, data }
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

export async function restoreLink(link: Link): Promise<Result> {
  const parsed = restoreLinkInput.safeParse(link)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    await actions.restore.handler(parsed.data)
    refresh()
    return { ok: true, data: undefined }
  } catch {
    return { ok: false, error: "The link couldn't be put back. Save it again from its URL." }
  }
}
