import "server-only"
import { and, asc, count, eq, gte, ilike, inArray, lte, notInArray, or, type SQL } from "drizzle-orm"
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
  kindLabels,
  listDocumentsInput,
  renewDocumentInput,
  updateDocumentInput,
  upcomingInput,
  type AttachedFile,
  type DocumentDetail,
  type DocumentHistoryEntry,
  type DocumentItem,
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

function toItem(row: Row, today: string, fileCount: number): DocumentItem {
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
    fileCount,
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

async function fileCounts(tx: Tx, ids: string[]) {
  const map = new Map<string, number>()
  if (!ids.length) return map
  const rows = await tx
    .select({ documentId: df.documentId, n: count() })
    .from(df)
    .where(inArray(df.documentId, ids))
    .groupBy(df.documentId)
  for (const row of rows) map.set(row.documentId, Number(row.n))
  return map
}

async function attachedFiles(tx: Tx, id: string): Promise<AttachedFile[]> {
  return tx
    .select({ id: filesFiles.id, name: filesFiles.name, size: filesFiles.sizeBytes, mime: filesFiles.mime })
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

async function findRow(tx: Tx, id: string) {
  const [row] = await tx.select(columns).from(d).where(eq(d.id, id))
  return row ?? null
}

async function detail(tx: Tx, id: string, today: string): Promise<DocumentDetail | null> {
  const row = await findRow(tx, id)
  if (!row) return null
  const files = await attachedFiles(tx, id)
  return { ...toItem(row, today, files.length), today, files }
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
        const counts = await fileCounts(tx, rows.map((r) => r.id))
        return { today, documents: rows.map((row) => toItem(row, today, counts.get(row.id) ?? 0)) }
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
        const counts = await fileCounts(tx, rows.map((r) => r.id))
        return { today, documents: rows.map((row) => toItem(row, today, counts.get(row.id) ?? 0)) }
      })
    },
  }),
  create: defineAction({
    description:
      "Add a document: a name (\"Passport\"), its kind, the expiry date (YYYY-MM-DD, the last valid day), optionally the issue date and a short note, the days before expiry to be reminded in Telegram (default 90, 30, 7 and 0 = the day itself; [] = no reminders) and ids of Files items to attach. Never store document numbers.",
    kind: "write",
    input: createDocumentInput,
    handler: async ({ fileIds, ...fields }): Promise<DocumentDetail> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        try {
          const [row] = await tx
            .insert(d)
            .values({ ...fields, remindersFrom: today })
            .returning({ id: d.id })
          await setFiles(tx, row!.id, fileIds)
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
      "Change a document: only the fields given change. Changing the expiry date or the reminder days restarts its reminders from today. `fileIds`, when given, replaces the attached files. To record a renewal (keeping the old dates in the history) use renew instead.",
    kind: "write",
    input: updateDocumentInput,
    handler: async ({ id, fileIds, ...fields }): Promise<DocumentDetail> => {
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
      "Record that a document was renewed: the new expiry date (later than the current one), optionally the new issue date and ids of Files items to attach as well (the new scan). The previous dates move to the document's history and its reminders start over for the new date.",
    kind: "write",
    input: renewDocumentInput,
    handler: async ({ id, expiresOn, issuedOn, addFileIds }): Promise<DocumentDetail> => {
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
