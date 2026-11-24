import { z } from "zod"

// Mirrors the contact tables in src/db/schema/feedback.ts (kept separate so
// client components don't pull Drizzle into the browser bundle;
// contact/schema.test.ts checks they match).
export const contactTopics = ["job", "freelance", "other"] as const
export type ContactTopic = (typeof contactTopics)[number]
export const contactStatuses = ["new", "replied", "archived"] as const
export type ContactStatus = (typeof contactStatuses)[number]

export const topicLabels: Record<ContactTopic, string> = {
  job: "Job offer",
  freelance: "Freelance project",
  other: "Other",
}

export const contactStatusLabels: Record<ContactStatus, string> = {
  new: "New",
  replied: "Replied",
  archived: "Archived",
}

export const CONTACT = {
  nameMax: 100,
  emailMax: 200,
  companyMax: 120,
  messageMin: 10,
  messageMax: 5000,
} as const

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The form as the server reads it (FormData values are strings or missing). */
export const contactFormInput = z.object({
  topic: z.enum(contactTopics, { error: "Pick what it's about." }),
  name: z
    .string({ error: "Tell me your name." })
    .trim()
    .min(1, "Tell me your name.")
    .max(CONTACT.nameMax, `Keep the name under ${CONTACT.nameMax} characters.`),
  email: z
    .string({ error: "Enter your email so I can answer." })
    .trim()
    .toLowerCase()
    .min(1, "Enter your email so I can answer.")
    .max(CONTACT.emailMax, "That email is too long.")
    .regex(EMAIL, "Enter an email like jana@example.com."),
  company: z.string().trim().max(CONTACT.companyMax, `Keep the company under ${CONTACT.companyMax} characters.`).default(""),
  message: z
    .string({ error: "Write your message." })
    .trim()
    .min(CONTACT.messageMin, `Write a little more — at least ${CONTACT.messageMin} characters.`)
    .max(CONTACT.messageMax, `Keep it under ${CONTACT.messageMax} characters.`),
  /** Honeypot: hidden from people, filled in by naive bots. */
  website: z.string().max(500).default(""),
  token: z.string().max(300).default(""),
})

export type ContactField = "topic" | "name" | "email" | "company" | "message"

/** What the visitor typed, echoed back so a no-JS round trip keeps it. */
export type ContactValues = { topic: string; name: string; email: string; company: string; message: string }

export const emptyValues: ContactValues = { topic: "", name: "", email: "", company: "", message: "" }

export type ContactFormState =
  | { status: "idle"; values: ContactValues; token?: string }
  /** The form's token had expired (open for hours): the server issued a fresh one; one more press sends. */
  | { status: "confirm"; values: ContactValues; token: string }
  | {
      status: "error"
      values: ContactValues
      token?: string
      error: string
      field?: ContactField
      /** Rate limited: seconds until a send can go through. */
      retryAfter?: number
    }
  | { status: "sent"; topic: ContactTopic; name: string; email: string; message: string }

/**
 * What /contact?error=<code> says to someone who sent the form without
 * JavaScript (the server redirects there; see contact/submit.ts). Without
 * JavaScript the text can't be kept, so each one says to write it again.
 */
export const noScriptNotices = {
  invalid: "Something in the form wasn't right. Check the fields and send again.",
  expired: "The form had been open too long. Please send it again.",
  fast: "That was very quick. Fill in the form, wait a few seconds and send again.",
  burst: "You've sent 3 messages in the last 10 minutes — that's the limit. Try again in a few minutes.",
  daily: "You've sent 10 messages today — that's the daily limit. Try again tomorrow.",
  closed: "The contact form isn't open yet. Try again later.",
  network: "That didn't send. Please try again in a minute.",
} as const

export type NoScriptNotice = keyof typeof noScriptNotices

export type ContactMessage = {
  id: string
  topic: ContactTopic
  name: string
  email: string
  company: string | null
  message: string
  status: ContactStatus
  created_at: string
  updated_at: string
}

export const listContactInput = z.object({
  /** "open" = everything except archived (the default view). */
  filter: z.enum(["open", ...contactStatuses]).default("open"),
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(500).default(200),
})
export type ContactFilter = z.infer<typeof listContactInput>["filter"]

export const contactIdInput = z.object({ id: z.uuid() })
export const setContactStatusInput = z.object({ id: z.uuid(), status: z.enum(contactStatuses) })

/** A mailto: link that answers the message, quoting its first lines. */
export function replyHref(m: Pick<ContactMessage, "email" | "name" | "topic" | "message">) {
  const subject = `Re: ${topicLabels[m.topic]} — anwar-os.com`
  const quoted = m.message
    .split("\n")
    .slice(0, 12)
    .map((line) => `> ${line}`)
    .join("\n")
  const body = `Hi ${m.name.split(/\s+/)[0]},\n\n\n\n${quoted}`
  return `mailto:${encodeURIComponent(m.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
