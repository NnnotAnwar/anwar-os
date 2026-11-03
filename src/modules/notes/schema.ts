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

export const listNotesInput = z.object({
  limit: z.number().int().min(1).max(200).default(100),
  query: z.string().trim().max(100).optional(),
  pinned: z.boolean().optional(),
})

export type Note = {
  id: string
  title: string
  body: string
  pinned: boolean
  updated_at: string
}

/** A one-line preview of the body, centered on `query` when it matches. */
export function excerpt(body: string, query?: string, length = 120) {
  const flat = body.replace(/\s+/g, " ").trim()
  if (!flat) return ""
  const at = query ? flat.toLowerCase().indexOf(query.toLowerCase()) : -1
  const start = at > 40 ? at - 40 : 0
  const slice = flat.slice(start, start + length)
  return `${start > 0 ? "…" : ""}${slice}${start + length < flat.length ? "…" : ""}`
}
