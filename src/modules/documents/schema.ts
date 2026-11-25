// Inputs and shared types for the documents module. Client-safe.
import { z } from "zod"
import { documentKinds, type DocumentHistoryEntry, type DocumentKind } from "@/db/schema/documents"
import { isIsoDay } from "./lib/dates"
import { DEFAULT_REMINDER_DAYS, MAX_REMINDER_DAYS, MAX_REMINDERS, normalizeReminderDays } from "./lib/reminders"
import type { DocumentStatus } from "./lib/status"

export { documentKinds, DEFAULT_REMINDER_DAYS }
export type { DocumentKind, DocumentHistoryEntry }

/** Where scans uploaded from the document form land in Files (top level, made on first use). */
export const DOCUMENTS_FOLDER = "Documents"
export const MAX_FILES = 20

export const kindLabels: Record<DocumentKind, string> = {
  passport: "Passport",
  residence_permit: "Residence permit / visa",
  id_card: "ID card",
  driving_licence: "Driving licence",
  insurance: "Insurance",
  other: "Other",
}

/** For Telegram cards and ⌘K titles. */
export const kindEmoji: Record<DocumentKind, string> = {
  passport: "🛂",
  residence_permit: "🪪",
  id_card: "🪪",
  driving_licence: "🚗",
  insurance: "🩺",
  other: "📄",
}

const isoDay = z.string().refine(isIsoDay, "Use a date like 2026-12-24.")

export const documentFields = {
  name: z.string().trim().min(1, "Give the document a name, e.g. Passport.").max(80, "Keep the name under 80 characters."),
  kind: z.enum(documentKinds, { error: "Pick what kind of document it is." }),
  expiresOn: isoDay,
  issuedOn: isoDay.nullable(),
  notes: z.string().trim().max(500, "Keep notes under 500 characters."),
  reminderDays: z
    .array(
      z
        .number()
        .int("Reminders are whole days.")
        .min(0, "A reminder can't be after the expiry date.")
        .max(MAX_REMINDER_DAYS, "Reminders go up to two years (730 days) ahead."),
    )
    .max(MAX_REMINDERS, `Up to ${MAX_REMINDERS} reminders.`)
    .transform(normalizeReminderDays),
  fileIds: z
    .array(z.uuid())
    .max(MAX_FILES, `Attach up to ${MAX_FILES} files.`)
    .transform((ids) => [...new Set(ids)]),
}

const issuedBeforeExpiry = (v: { issuedOn?: string | null; expiresOn?: string }) => !v.issuedOn || !v.expiresOn || v.issuedOn <= v.expiresOn
const issuedMessage = { message: "The issue date can't be after the expiry date.", path: ["issuedOn"] }

export const createDocumentInput = z
  .object({
    name: documentFields.name,
    kind: documentFields.kind.default("other"),
    expiresOn: documentFields.expiresOn,
    issuedOn: documentFields.issuedOn.default(null),
    notes: documentFields.notes.default(""),
    reminderDays: documentFields.reminderDays.default([...DEFAULT_REMINDER_DAYS]),
    fileIds: documentFields.fileIds.default([]),
  })
  .refine(issuedBeforeExpiry, issuedMessage)

/** Only the fields given change; `fileIds`, when given, replaces the attached files. */
export const updateDocumentInput = z
  .object({
    id: z.uuid(),
    name: documentFields.name.optional(),
    kind: documentFields.kind.optional(),
    expiresOn: documentFields.expiresOn.optional(),
    issuedOn: documentFields.issuedOn.optional(),
    notes: documentFields.notes.optional(),
    reminderDays: documentFields.reminderDays.optional(),
    fileIds: documentFields.fileIds.optional(),
  })
  .refine(issuedBeforeExpiry, issuedMessage)

export const renewDocumentInput = z
  .object({
    id: z.uuid(),
    expiresOn: documentFields.expiresOn,
    /** Omitted = cleared (the old issue date moves to the history). */
    issuedOn: documentFields.issuedOn.default(null),
    /** Files to attach as well (the new scan); the attached ones stay. */
    addFileIds: documentFields.fileIds.default([]),
  })
  .refine(issuedBeforeExpiry, issuedMessage)

export const documentIdInput = z.object({ id: z.uuid() })

export const listDocumentsInput = z.object({
  query: z.string().trim().max(100).optional(),
  kind: z.enum(documentKinds).optional(),
  limit: z.number().int().min(1).max(200).default(100),
})

export const upcomingInput = z.object({
  days: z.number().int().min(0).max(MAX_REMINDER_DAYS).default(90),
  includeExpired: z.boolean().default(true),
})

export type AttachedFile = { id: string; name: string; size: number; mime: string }

export type DocumentItem = {
  id: string
  name: string
  kind: DocumentKind
  expiresOn: string
  issuedOn: string | null
  notes: string
  /** Largest first; empty = no reminders. */
  reminderDays: number[]
  snoozedUntil: string | null
  /** Earlier renewals, newest first. */
  history: DocumentHistoryEntry[]
  fileCount: number
  status: DocumentStatus
  createdAt: string
  updatedAt: string
}

export type DocumentDetail = DocumentItem & { today: string; files: AttachedFile[] }

export type DocumentsList = { today: string; documents: DocumentItem[] }
