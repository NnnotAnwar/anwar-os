import { sql } from "drizzle-orm"
import { check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { filesFiles } from "./files"

// Module: documents (passport, residence permit, insurance… with expiry dates
// and osbot reminders). Private only: nothing here is ever public. RLS,
// triggers and grants live in db/modules/documents.sql; Drizzle only describes
// the shape. There is deliberately no column for a document number.

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

export const documentKinds = ["passport", "residence_permit", "id_card", "driving_licence", "insurance", "other"] as const
export type DocumentKind = (typeof documentKinds)[number]

/** Which side of the card a scan shows: the document page offers both to flip through. */
export const documentSides = ["front", "back"] as const
export type DocumentSide = (typeof documentSides)[number]

/** A renewal kept on the document: the dates it had before ("Renewed" moves them here). */
export type DocumentHistoryEntry = { expiresOn: string; issuedOn: string | null; renewedOn: string }

/**
 * One document with an expiry date. `reminder_days` are the days before
 * `expires_on` osbot reminds at 10:00 (0 = the day itself); empty = no
 * reminders. `snoozed_until` is osbot's "Remind tomorrow". `history` keeps the
 * dates of earlier renewals, newest first.
 */
export const documentsDocuments = pgTable(
  "documents_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    kind: text("kind", { enum: documentKinds }).notNull().default("other"),
    expiresOn: date("expires_on").notNull(),
    issuedOn: date("issued_on"),
    notes: text("notes").notNull().default(""),
    reminderDays: integer("reminder_days")
      .array()
      .notNull()
      .default(sql`'{90,30,7,0}'::integer[]`),
    // The owner's day the current expiry date and offsets were set: reminders
    // whose day falls before it are never sent late (a fresh renewal doesn't
    // trigger a "90 days left" card for a stage that passed before it).
    remindersFrom: date("reminders_from").notNull().default(sql`current_date`),
    snoozedUntil: date("snoozed_until"),
    history: jsonb("history").$type<DocumentHistoryEntry[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The target of documents_files' (owner_id, document_id) foreign key.
    unique("documents_documents_owner_id_key").on(t.ownerId, t.id),
    index("documents_documents_owner_expires_idx").on(t.ownerId, t.expiresOn),
    check("documents_documents_name_length", sql`char_length(${t.name}) between 1 and 80`),
    check("documents_documents_kind_valid", sql`${t.kind} in (${sql.raw(documentKinds.map((k) => `'${k}'`).join(", "))})`),
    check("documents_documents_notes_length", sql`char_length(${t.notes}) <= 500`),
    check("documents_documents_issued_before_expiry", sql`${t.issuedOn} is null or ${t.issuedOn} <= ${t.expiresOn}`),
    check(
      "documents_documents_reminder_days_valid",
      sql`cardinality(${t.reminderDays}) <= 8 and array_position(${t.reminderDays}, null) is null and 0 <= all(${t.reminderDays}) and 730 >= all(${t.reminderDays})`,
    ),
    check("documents_documents_history_valid", sql`jsonb_typeof(${t.history}) = 'array' and jsonb_array_length(${t.history}) <= 20`),
  ],
)

/**
 * Files items attached to a document (scans live in Files, usually in the
 * "Documents" folder). Deleting the file removes the link; deleting the
 * document leaves the file in Files. RLS only lets a link point at the
 * viewer's own file (db/modules/documents.sql). `side` marks the photo of the
 * card's front or back (at most one of each per document); null = just a file.
 */
export const documentsFiles = pgTable(
  "documents_files",
  {
    ownerId: ownerId(),
    documentId: uuid("document_id").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => filesFiles.id, { onDelete: "cascade" }),
    side: text("side", { enum: documentSides }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "documents_files_pkey", columns: [t.documentId, t.fileId] }),
    // With owner_id in the key, a link can only belong to the owner's own document.
    foreignKey({
      name: "documents_files_document_fk",
      columns: [t.ownerId, t.documentId],
      foreignColumns: [documentsDocuments.ownerId, documentsDocuments.id],
    }).onDelete("cascade"),
    index("documents_files_file_idx").on(t.fileId),
    // Nulls are distinct: any number of plain files, one front and one back.
    unique("documents_files_document_side_key").on(t.documentId, t.side),
    check("documents_files_side_valid", sql`${t.side} is null or ${t.side} in ('front', 'back')`),
    index("documents_files_owner_idx").on(t.ownerId),
  ],
)
