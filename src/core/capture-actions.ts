"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { bodyFor, inboxText, isCaptureDestination, titleFor, type CaptureDestinationId, type CaptureDraft } from "@/core/capture"
import { captureToInbox } from "@/modules/inbox/server-actions"
import { actions as ideas } from "@/modules/ideas/actions"
import { createIdeaInput } from "@/modules/ideas/schema"
import { actions as links } from "@/modules/links/actions"
import { createLinkInput } from "@/modules/links/schema"
import { actions as notes } from "@/modules/notes/actions"
import { createNoteInput } from "@/modules/notes/schema"

export type CaptureResult = { ok: true; href: string; message: string } | { ok: false; error: string }

const draftInput = z.object({
  title: z.string().max(200, "Keep the title under 200 characters."),
  text: z.string().max(20_000, "That's too long to capture in one go."),
  url: z.string().max(2000, "That link is too long."),
})

const OFFLINE = "That wasn't saved. Check your connection and try again."

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check what you're saving and try again."
}

/**
 * One saver per destination in captureDestinations (src/core/capture.ts). Each
 * goes through the module's own typed actions, so validation and RLS are the
 * module's; the result says where the new item lives.
 */
const savers: Record<CaptureDestinationId, (draft: CaptureDraft, shared: boolean) => Promise<CaptureResult>> = {
  async inbox(draft, shared) {
    const result = await captureToInbox({ text: inboxText(draft), url: draft.url || null, source: shared ? "share" : "app" })
    return result.ok ? { ok: true, href: "/app/inbox", message: "Saved to Inbox." } : result
  },

  async note(draft) {
    const parsed = createNoteInput.safeParse({ title: titleFor(draft), body: bodyFor(draft) })
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
    const { id } = await notes.create.handler(parsed.data)
    revalidatePath("/app/notes")
    return { ok: true, href: `/app/notes/${id}`, message: "Saved to Notes." }
  },

  async link(draft) {
    if (!draft.url) return { ok: false, error: "Add the link's address to save it as a link." }
    const note = [draft.title.trim(), draft.text.trim()].filter(Boolean).join("\n\n")
    const parsed = createLinkInput.safeParse({ url: draft.url, note })
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
    const { id, duplicate } = await links.create.handler(parsed.data)
    revalidatePath("/app/links", "layout")
    return { ok: true, href: `/app/links/${id}`, message: duplicate ? "Already in Links." : "Saved to Links." }
  },

  async idea(draft) {
    const parsed = createIdeaInput.safeParse({ title: titleFor(draft), body: bodyFor(draft) })
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
    const { id } = await ideas.create.handler(parsed.data)
    revalidatePath("/app/ideas")
    return { ok: true, href: `/app/ideas/${id}`, message: "Saved to Ideas." }
  },
}

/** Saves a capture. `shared` marks it as coming from another app's share sheet. */
export async function saveCapture(destination: string, draft: CaptureDraft, shared = false): Promise<CaptureResult> {
  if (!isCaptureDestination(destination)) return { ok: false, error: "Pick where to save it." }
  const parsed = draftInput.safeParse(draft)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const { title, text, url } = parsed.data
  if (!title.trim() && !text.trim() && !url.trim()) return { ok: false, error: "Write something or paste a link first." }
  try {
    return await savers[destination]({ title, text, url: url.trim() }, shared)
  } catch (error) {
    console.error("capture failed", error)
    return { ok: false, error: OFFLINE }
  }
}
