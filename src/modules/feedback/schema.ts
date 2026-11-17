import { z } from "zod"

// Mirrors src/db/schema/feedback.ts (kept separate so client components don't
// pull Drizzle into the browser bundle; schema.test.ts checks they match).
export const feedbackKinds = ["complaint", "suggestion", "question", "thanks"] as const
export type FeedbackKind = (typeof feedbackKinds)[number]
export const feedbackStatuses = ["new", "read", "in_progress", "done", "spam"] as const
export type FeedbackStatus = (typeof feedbackStatuses)[number]

export const kindLabels: Record<FeedbackKind, string> = {
  complaint: "Complaint",
  suggestion: "Suggestion",
  question: "Question",
  thanks: "Thanks",
}

export const statusLabels: Record<FeedbackStatus, string> = {
  new: "New",
  read: "Read",
  in_progress: "In progress",
  done: "Done",
  spam: "Spam",
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TELEGRAM = /^(?:@|(?:https?:\/\/)?t\.me\/)?([a-z][a-z0-9_]{4,31})$/i

/**
 * An email address or a Telegram handle (as @name, name or a t.me link).
 * Returns the cleaned value ("@name" for Telegram), "" for empty, null if neither.
 */
export function normalizeContact(raw: string): string | null {
  const value = raw.trim()
  if (!value) return ""
  if (EMAIL.test(value)) return value.length <= 200 ? value : null
  const tg = value.match(TELEGRAM)
  if (tg) return `@${tg[1]}`
  return null
}

/** Whether a stored contact is an email (link with mailto:) or a Telegram handle (t.me). */
export function contactHref(contact: string) {
  if (EMAIL.test(contact)) return `mailto:${contact}`
  // Stored handles are always normalized to "@name".
  const tg = contact.match(/^@([a-z][a-z0-9_]{4,31})$/i)
  return tg ? `https://t.me/${tg[1]}` : null
}

export const MESSAGE_MIN = 10
export const MESSAGE_MAX = 5000

export const solutionInput = z.object({
  algorithm: z.literal("SHA-256"),
  challenge: z.string().regex(/^[0-9a-f]{64}$/),
  salt: z.string().min(16).max(120),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
  number: z.number().int().min(0),
})

export const submitFeedbackInput = z.object({
  kind: z.enum(feedbackKinds, { error: "Pick what kind of message this is." }),
  message: z
    .string()
    .trim()
    .min(MESSAGE_MIN, `Write a little more — at least ${MESSAGE_MIN} characters.`)
    .max(MESSAGE_MAX, `Keep it under ${MESSAGE_MAX} characters, or split it in two.`),
  name: z.string().trim().max(100, "Keep the name under 100 characters.").default(""),
  contact: z
    .string()
    .max(250)
    .default("")
    .transform((value, ctx) => {
      const contact = normalizeContact(value)
      if (contact === null) {
        ctx.addIssue({
          code: "custom",
          message: "Enter an email (e.g. jana@example.com) or a Telegram handle (e.g. @jana), or leave it empty.",
        })
        return z.NEVER
      }
      return contact
    }),
  /** Honeypot: hidden from people, filled in by naive bots. */
  website: z.string().max(500).default(""),
  solution: solutionInput,
})

export type SubmitFeedbackInput = z.input<typeof submitFeedbackInput>

export const inboxFilters = ["inbox", ...feedbackStatuses] as const
export type InboxFilter = (typeof inboxFilters)[number]

export const listFeedbackInput = z.object({
  filter: z.enum(inboxFilters).default("inbox"),
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(500).default(200),
})

export const feedbackIdInput = z.object({ id: z.uuid() })
export const setStatusInput = z.object({ id: z.uuid(), status: z.enum(feedbackStatuses) })
export const saveReplyNoteInput = z.object({
  id: z.uuid(),
  replyNote: z.string().max(20_000, "This note is too long to save. Keep it under 20 000 characters."),
})

export type FeedbackItem = {
  id: string
  kind: FeedbackKind
  message: string
  name: string | null
  contact: string | null
  status: FeedbackStatus
  reply_note: string
  created_at: string
  updated_at: string
}

/** A rate-limit wait as people say it: "0:45", "4:32", "3 h 12 min". */
export function formatWait(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds))
  if (s >= 3600) {
    const h = Math.floor(s / 3600)
    const m = Math.ceil((s % 3600) / 60)
    return m === 60 ? `${h + 1} h` : m ? `${h} h ${m} min` : `${h} h`
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** First line of a message, cut for a list row or a notification. */
export function preview(message: string, length = 140) {
  const flat = message.replace(/\s+/g, " ").trim()
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat
}
