import { markdownToText } from "@/lib/markdown"
import { z } from "zod"

export const noteFields = {
  title: z.string().trim().min(1, "Give the note a title.").max(200, "Keep the title under 200 characters."),
  body: z.string().max(100_000, "This note is too long to save."),
}

export const createNoteInput = z.object({
  title: noteFields.title,
  body: noteFields.body.default(""),
})

export const updateNoteInput = z.object({ id: z.uuid(), ...noteFields })

export const setPinnedInput = z.object({ id: z.uuid(), pinned: z.boolean() })

export const noteIdInput = z.object({ id: z.uuid() })

export const noteIdsInput = z.object({ ids: z.array(z.uuid()).min(1).max(200) })
export const pinNotesInput = z.object({ ids: z.array(z.uuid()).min(1).max(200), pinned: z.boolean() })

export const listNotesInput = z.object({
  limit: z.number().int().min(1).max(200).default(100),
  query: z.string().trim().max(100).optional(),
  pinned: z.boolean().optional(),
})

/** Publishing a note on /writing: one toggle plus its address, summary and date. */
export const notePublishingInput = z.object({
  id: z.uuid(),
  isPublic: z.boolean(),
  /** Empty: derived from the title (and made unique). */
  slug: z
    .string()
    .trim()
    .max(80, "Keep the address under 80 characters.")
    .refine((v) => v === "" || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v), "Use lowercase letters, digits and single dashes in the address."),
  excerpt: z.string().trim().max(300, "Keep the summary under 300 characters."),
  /** YYYY-MM-DD, or empty for "now" on the first publish. */
  publishedOn: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))), "Pick a valid date."),
})
export type NotePublishingInput = z.infer<typeof notePublishingInput>

export type Note = {
  id: string
  title: string
  body: string
  pinned: boolean
  updated_at: string
  isPublic: boolean
  slug: string | null
  excerpt: string
  /** ISO timestamp, set on the first publish. */
  publishedAt: string | null
}

/** What visitors see on /writing: no private flags. */
export type PublicNote = {
  id: string
  title: string
  slug: string
  excerpt: string
  body: string
  publishedAt: string
  updatedAt: string
}

/** Cache tag for every public read of notes (/writing, the feeds, the sitemap). */
export const PUBLIC_NOTES_TAG = "notes:public"

/** The summary shown on /writing and in the feeds: the excerpt, or the body's start. */
export function summaryOf(note: Pick<PublicNote, "excerpt" | "body">, length = 220) {
  if (note.excerpt.trim()) return note.excerpt.trim()
  return excerpt(note.body, undefined, length)
}

/** A one-line preview of the body, centered on `query` when it matches. */
export function excerpt(body: string, query?: string, length = 120) {
  // Checklist boxes and markdown marks are noise in a one-line preview.
  const flat = markdownToText(body.replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "· ")).replace(/^· /, "")
  if (!flat) return ""
  const at = query ? flat.toLowerCase().indexOf(query.toLowerCase()) : -1
  const start = at > 40 ? at - 40 : 0
  const slice = flat.slice(start, start + length)
  return `${start > 0 ? "…" : ""}${slice}${start + length < flat.length ? "…" : ""}`
}
