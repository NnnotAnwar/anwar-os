// Inputs and shared types for the documents module. Client-safe.
import { z } from "zod"
import { documentKinds, documentSides, type DocumentHistoryEntry, type DocumentKind, type DocumentSide } from "@/db/schema/documents"
import { isIsoDay } from "./lib/dates"
import { DEFAULT_REMINDER_DAYS, MAX_REMINDER_DAYS, MAX_REMINDERS, normalizeReminderDays } from "./lib/reminders"
import type { DocumentStatus } from "./lib/status"

export { documentKinds, documentSides, DEFAULT_REMINDER_DAYS }
export type { DocumentKind, DocumentHistoryEntry, DocumentSide }

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
  /** The photo of the card's front / back: one of the attached files (an image); null = none. */
  sideFileId: z.uuid().nullable(),
}

const issuedBeforeExpiry = (v: { issuedOn?: string | null; expiresOn?: string }) => !v.issuedOn || !v.expiresOn || v.issuedOn <= v.expiresOn
const issuedMessage = { message: "The issue date can't be after the expiry date.", path: ["issuedOn"] }
const twoSides = (v: { frontFileId?: string | null; backFileId?: string | null }) => !v.frontFileId || v.frontFileId !== v.backFileId
const sidesMessage = { message: "Pick different photos for the front and the back.", path: ["backFileId"] }

export const createDocumentInput = z
  .object({
    name: documentFields.name,
    kind: documentFields.kind.default("other"),
    expiresOn: documentFields.expiresOn,
    issuedOn: documentFields.issuedOn.default(null),
    notes: documentFields.notes.default(""),
    reminderDays: documentFields.reminderDays.default([...DEFAULT_REMINDER_DAYS]),
    fileIds: documentFields.fileIds.default([]),
    frontFileId: documentFields.sideFileId.default(null),
    backFileId: documentFields.sideFileId.default(null),
  })
  .refine(issuedBeforeExpiry, issuedMessage)
  .refine(twoSides, sidesMessage)

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
    /** Omitted = kept (while that file stays attached); null = no front photo. */
    frontFileId: documentFields.sideFileId.optional(),
    backFileId: documentFields.sideFileId.optional(),
  })
  .refine(issuedBeforeExpiry, issuedMessage)
  .refine(twoSides, sidesMessage)

export const renewDocumentInput = z
  .object({
    id: z.uuid(),
    expiresOn: documentFields.expiresOn,
    /** Omitted = cleared (the old issue date moves to the history). */
    issuedOn: documentFields.issuedOn.default(null),
    /** Files to attach as well (the new scan); the attached ones stay. */
    addFileIds: documentFields.fileIds.default([]),
    /** The new card's photos (attached or among addFileIds); omitted = the current ones stay. */
    frontFileId: documentFields.sideFileId.optional(),
    backFileId: documentFields.sideFileId.optional(),
  })
  .refine(issuedBeforeExpiry, issuedMessage)
  .refine(twoSides, sidesMessage)

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

export type AttachedFile = { id: string; name: string; size: number; mime: string; side?: DocumentSide | null }

/** Files that can be a side of the card: photos the browser shows inline (no SVG). */
export const isCardPhoto = (mime: string) => mime.startsWith("image/") && mime !== "image/svg+xml"

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
  /** The photo of the front, for the list's thumbnail. */
  frontFileId: string | null
  status: DocumentStatus
  createdAt: string
  updatedAt: string
}

export type DocumentDetail = DocumentItem & { today: string; files: AttachedFile[] }

export type DocumentsList = { today: string; documents: DocumentItem[] }
