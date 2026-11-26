import "server-only"
import { and, asc, count, eq, gte, ilike, inArray, lte, notInArray, or, sql, type SQL } from "drizzle-orm"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { documentsDocuments as d, documentsFiles as df, filesFiles } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { addDaysIso, ownerClock } from "./lib/dates"
import { documentStatus } from "./lib/status"
import {
  createDocumentInput,
  documentIdInput,
  documentKinds,
  isCardPhoto,
  kindLabels,
  listDocumentsInput,
  renewDocumentInput,
  updateDocumentInput,
  upcomingInput,
  type AttachedFile,
  type DocumentDetail,
  type DocumentHistoryEntry,
  type DocumentItem,
  type DocumentSide,
  type DocumentsList,
} from "./schema"

/** A message the UI and the bot can show as is (missing document, bad dates…). */
export class DocumentInputError extends Error {}

const HISTORY_KEPT = 20

const columns = {
  id: d.id,
  name: d.name,
  kind: d.kind,
  expiresOn: d.expiresOn,
  issuedOn: d.issuedOn,
  notes: d.notes,
  reminderDays: d.reminderDays,
  remindersFrom: d.remindersFrom,
  snoozedUntil: d.snoozedUntil,
  history: d.history,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
}

type Row = {
  id: string
  name: string
  kind: DocumentItem["kind"]
  expiresOn: string
  issuedOn: string | null
  notes: string
  reminderDays: number[]
  remindersFrom: string
  snoozedUntil: string | null
  history: DocumentHistoryEntry[]
  createdAt: Date
  updatedAt: Date
}

export type DocumentRow = Row

type FileSummary = { count: number; front: string | null }
const NO_FILES: FileSummary = { count: 0, front: null }

function toItem(row: Row, today: string, files: FileSummary): DocumentItem {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    expiresOn: row.expiresOn,
    issuedOn: row.issuedOn,
    notes: row.notes,
    reminderDays: row.reminderDays,
    snoozedUntil: row.snoozedUntil,
    history: row.history,
    fileCount: files.count,
    frontFileId: files.front,
    status: documentStatus(row.expiresOn, today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The viewer's calendar day: "today" depends on their zone, not the server's. */
export async function viewerToday() {
  // The session first: reading the clock before any request data breaks prerendering.
  const viewer = await requireViewer()
  return ownerClock(viewer.timezone, new Date()).today
}

/** How many files each document has, and its front photo (the list's thumbnail). */
async function fileSummaries(tx: Tx, ids: string[]) {
  const map = new Map<string, FileSummary>()
  if (!ids.length) return map
  const rows = await tx
    .select({ documentId: df.documentId, n: count(), front: sql<string | null>`(array_agg(${df.fileId}) filter (where ${df.side} = 'front'))[1]` })
    .from(df)
    .where(inArray(df.documentId, ids))
    .groupBy(df.documentId)
  for (const row of rows) map.set(row.documentId, { count: Number(row.n), front: row.front })
  return map
}

async function attachedFiles(tx: Tx, id: string): Promise<AttachedFile[]> {
  return tx
    .select({ id: filesFiles.id, name: filesFiles.name, size: filesFiles.sizeBytes, mime: filesFiles.mime, side: df.side })
    .from(df)
    .innerJoin(filesFiles, eq(filesFiles.id, df.fileId))
    .where(eq(df.documentId, id))
    .orderBy(asc(df.createdAt), asc(filesFiles.name))
}

/** Makes the document's attached files exactly `fileIds` (each must be one of the viewer's files). */
async function setFiles(tx: Tx, documentId: string, fileIds: string[]) {
  if (fileIds.length) {
    const found = await tx.select({ id: filesFiles.id }).from(filesFiles).where(inArray(filesFiles.id, fileIds))
    if (found.length !== fileIds.length) throw new DocumentInputError("One of the attached files no longer exists. Pick it again.")
  }
  await tx
    .delete(df)
    .where(fileIds.length ? and(eq(df.documentId, documentId), notInArray(df.fileId, fileIds)) : eq(df.documentId, documentId))
  if (fileIds.length) {
    await tx
      .insert(df)
      .values(fileIds.map((fileId) => ({ documentId, fileId })))
      .onConflictDoNothing({ target: [df.documentId, df.fileId] })
  }
}

/**
 * Makes `fileId` (one of the document's attached files, a photo) its `side`,
 * or leaves that side empty. A file has one side, so marking the back's photo
 * as the front moves it.
 */
async function setSide(tx: Tx, documentId: string, side: DocumentSide, fileId: string | null) {
  if (fileId) {
    const [file] = await tx
      .select({ mime: filesFiles.mime })
      .from(df)
      .innerJoin(filesFiles, eq(filesFiles.id, df.fileId))
      .where(and(eq(df.documentId, documentId), eq(df.fileId, fileId)))
    if (!file) throw new DocumentInputError(`The ${side} of the card should be one of the attached files.`)
    if (!isCardPhoto(file.mime)) throw new DocumentInputError(`The ${side} of the card needs a photo (JPEG or PNG), not a PDF.`)
  }
  await tx.update(df).set({ side: null }).where(and(eq(df.documentId, documentId), eq(df.side, side)))
  if (fileId) await tx.update(df).set({ side }).where(and(eq(df.documentId, documentId), eq(df.fileId, fileId)))
}

/** Applies the sides given (undefined = unchanged). */
async function setSides(tx: Tx, documentId: string, sides: { frontFileId?: string | null; backFileId?: string | null }) {
  if (sides.frontFileId !== undefined) await setSide(tx, documentId, "front", sides.frontFileId)
  if (sides.backFileId !== undefined) await setSide(tx, documentId, "back", sides.backFileId)
}

async function findRow(tx: Tx, id: string) {
  const [row] = await tx.select(columns).from(d).where(eq(d.id, id))
  return row ?? null
}

async function detail(tx: Tx, id: string, today: string): Promise<DocumentDetail | null> {
  const row = await findRow(tx, id)
  if (!row) return null
  const files = await attachedFiles(tx, id)
  const front = files.find((f) => f.side === "front")?.id ?? null
  return { ...toItem(row, today, { count: files.length, front }), today, files }
}

function isCheckViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code === "23514" || e.cause?.code === "23514"
}

/** Kinds whose label contains the text ("visa" finds residence permits). */
function kindsMatching(query: string) {
  const q = query.toLowerCase()
  return documentKinds.filter((k) => kindLabels[k].toLowerCase().includes(q))
}

export const actions = {
  list: defineAction({
    description:
      "The user's documents (passport, residence permit / visa, ID card, driving licence, insurance, other) sorted by expiry date, soonest first, each with its status (valid, expires in N days, expired) and reminder days. Optionally filtered by text in the name (or kind) and by kind.",
    kind: "read",
    input: listDocumentsInput,
    handler: async ({ query, kind, limit }): Promise<DocumentsList> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const where: SQL[] = []
        if (query) {
          const kinds = kindsMatching(query)
          where.push(or(ilike(d.name, likeContains(query)), kinds.length ? inArray(d.kind, kinds) : undefined)!)
        }
        if (kind) where.push(eq(d.kind, kind))
        const rows = await tx
          .select(columns)
          .from(d)
          .where(where.length ? and(...where) : undefined)
          .orderBy(asc(d.expiresOn), asc(d.name))
          .limit(limit)
        const files = await fileSummaries(tx, rows.map((r) => r.id))
        return { today, documents: rows.map((row) => toItem(row, today, files.get(row.id) ?? NO_FILES)) }
      })
    },
  }),
  get: defineAction({
    description: "One document with its dates, status, reminder days, renewal history and attached files. Null if it doesn't exist.",
    kind: "read",
    input: documentIdInput,
    handler: async ({ id }): Promise<DocumentDetail | null> => {
      const today = await viewerToday()
      return asViewer((tx) => detail(tx, id, today))
    },
  }),
  upcoming: defineAction({
    description:
      "Documents expiring within the next `days` days (default 90), soonest first; expired ones are included unless includeExpired is false.",
    kind: "read",
    input: upcomingInput,
    handler: async ({ days, includeExpired }): Promise<DocumentsList> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const until = lte(d.expiresOn, addDaysIso(today, days))
        const rows = await tx
          .select(columns)
          .from(d)
          .where(includeExpired ? until : and(until, gte(d.expiresOn, today)))
          .orderBy(asc(d.expiresOn), asc(d.name))
        const files = await fileSummaries(tx, rows.map((r) => r.id))
        return { today, documents: rows.map((row) => toItem(row, today, files.get(row.id) ?? NO_FILES)) }
      })
    },
  }),
  create: defineAction({
    description:
      "Add a document: a name (\"Passport\"), its kind, the expiry date (YYYY-MM-DD, the last valid day), optionally the issue date and a short note, the days before expiry to be reminded in Telegram (default 90, 30, 7 and 0 = the day itself; [] = no reminders), ids of Files items to attach, and which attached photos show the card's front and back. Never store document numbers.",
    kind: "write",
    input: createDocumentInput,
    handler: async ({ fileIds, frontFileId, backFileId, ...fields }): Promise<DocumentDetail> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        try {
          const [row] = await tx
            .insert(d)
            .values({ ...fields, remindersFrom: today })
            .returning({ id: d.id })
          await setFiles(tx, row!.id, fileIds)
          await setSides(tx, row!.id, { frontFileId, backFileId })
          return (await detail(tx, row!.id, today))!
        } catch (error) {
          if (isCheckViolation(error)) throw new DocumentInputError("Check the dates and reminders: something is out of range.")
          throw error
        }
      })
    },
  }),
  update: defineAction({
    description:
      "Change a document: only the fields given change. Changing the expiry date or the reminder days restarts its reminders from today. `fileIds`, when given, replaces the attached files; `frontFileId` / `backFileId` pick the attached photos of the card's two sides (null = none). To record a renewal (keeping the old dates in the history) use renew instead.",
    kind: "write",
    input: updateDocumentInput,
    handler: async ({ id, fileIds, frontFileId, backFileId, ...fields }): Promise<DocumentDetail> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const current = await findRow(tx, id)
        if (!current) throw new DocumentInputError("That document doesn't exist anymore.")
        const expiresOn = fields.expiresOn ?? current.expiresOn
        const issuedOn = fields.issuedOn === undefined ? current.issuedOn : fields.issuedOn
        if (issuedOn && issuedOn > expiresOn) throw new DocumentInputError("The issue date can't be after the expiry date.")
        const dateChanged = expiresOn !== current.expiresOn
        const daysChanged = fields.reminderDays !== undefined && fields.reminderDays.join(",") !== current.reminderDays.join(",")
        const set: Partial<typeof d.$inferInsert> = {}
        if (fields.name !== undefined) set.name = fields.name
        if (fields.kind !== undefined) set.kind = fields.kind
        if (fields.expiresOn !== undefined) set.expiresOn = fields.expiresOn
        if (fields.issuedOn !== undefined) set.issuedOn = fields.issuedOn
        if (fields.notes !== undefined) set.notes = fields.notes
        if (fields.reminderDays !== undefined) set.reminderDays = fields.reminderDays
        if (dateChanged || daysChanged) set.remindersFrom = today
        if (dateChanged) set.snoozedUntil = null
        try {
          if (Object.keys(set).length) await tx.update(d).set(set).where(eq(d.id, id))
          if (fileIds) await setFiles(tx, id, fileIds)
          await setSides(tx, id, { frontFileId, backFileId })
        } catch (error) {
          if (isCheckViolation(error)) throw new DocumentInputError("Check the dates and reminders: something is out of range.")
          throw error
        }
        return (await detail(tx, id, today))!
      })
    },
  }),
  renew: defineAction({
    description:
      "Record that a document was renewed: the new expiry date (later than the current one), optionally the new issue date, ids of Files items to attach as well (the new scan) and which photos show the new card's front and back. The previous dates move to the document's history and its reminders start over for the new date.",
    kind: "write",
    input: renewDocumentInput,
    handler: async ({ id, expiresOn, issuedOn, addFileIds, frontFileId, backFileId }): Promise<DocumentDetail> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const current = await findRow(tx, id)
        if (!current) throw new DocumentInputError("That document doesn't exist anymore.")
        if (expiresOn <= current.expiresOn) {
          throw new DocumentInputError("The new expiry date should be later than the current one. To fix a date, edit the document instead.")
        }
        const history = [{ expiresOn: current.expiresOn, issuedOn: current.issuedOn, renewedOn: today }, ...current.history].slice(0, HISTORY_KEPT)
        await tx
          .update(d)
          .set({ expiresOn, issuedOn, history, remindersFrom: today, snoozedUntil: null })
          .where(eq(d.id, id))
        if (addFileIds.length) {
          const attached = await tx.select({ id: df.fileId }).from(df).where(eq(df.documentId, id))
          await setFiles(tx, id, [...new Set([...attached.map((a) => a.id), ...addFileIds])])
        }
        await setSides(tx, id, { frontFileId, backFileId })
        return (await detail(tx, id, today))!
      })
    },
  }),
  delete: defineAction({
    description: "Permanently delete a document. Its attached files stay in Files.",
    kind: "write",
    input: documentIdInput,
    handler: async ({ id }) =>
      asViewer(async (tx) => {
        const deleted = await tx.delete(d).where(eq(d.id, id)).returning({ id: d.id })
        return { deleted: deleted.length }
      }),
  }),
}

export { columns as documentColumns }
