// Inputs and shared types for the inbox. Client-safe.
import { z } from "zod"
import { inboxOutcomes, inboxSources, type InboxOutcome, type InboxSource } from "@/db/schema/inbox"

export { inboxOutcomes, inboxSources, type InboxOutcome, type InboxSource }

const webUrl = z
  .string()
  .trim()
  .max(2000, "That link is too long.")
  .refine((v) => /^https?:\/\//i.test(v), "Only web links (http or https) can be captured.")

export const captureInput = z
  .object({
    /** Optional id made by the client: capturing again with the same id returns the first item (offline retries). */
    id: z.uuid().optional(),
    text: z.string().max(10_000, "That's too long for the inbox — save it as a note instead.").default(""),
    url: webUrl.nullish(),
    source: z.enum(inboxSources).default("app"),
  })
  .refine((v) => v.text.trim().length > 0 || Boolean(v.url), "Write something or paste a link first.")

export const inboxIdInput = z.object({ id: z.uuid() })
export const updateInboxInput = z.object({ id: z.uuid(), text: z.string().max(10_000) })
export const processInput = z.object({
  id: z.uuid(),
  as: z.enum(inboxOutcomes),
  /** The text as edited on the processing card, if it changed. */
  text: z.string().max(10_000).optional(),
})
export const listInboxInput = z.object({
  processed: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(200),
})

export type InboxItem = {
  id: string
  text: string
  url: string | null
  source: InboxSource
  processedAt: string | null
  processedAs: InboxOutcome | null
  processedRef: string | null
  createdAt: string
}

export type ProcessResult = { outcome: InboxOutcome; ref: string; href: string; title: string }

export const outcomeLabels: Record<InboxOutcome, string> = {
  task: "Task",
  note: "Note",
  link: "Link",
  idea: "Idea",
  event: "Event",
}

/** Where each outcome lives, for "Added to …" toasts. */
export const outcomeModules: Record<InboxOutcome, { module: string; name: string }> = {
  task: { module: "tasks", name: "Tasks" },
  note: { module: "notes", name: "Notes" },
  link: { module: "links", name: "Links" },
  idea: { module: "ideas", name: "Ideas" },
  event: { module: "calendar", name: "Calendar" },
}

export const CAPTURE_EVENT = "anwar:capture"
