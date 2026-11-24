import "server-only"
import { and, desc, eq, ilike, like, ne, or, sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { notesNotes } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { slugify } from "@/lib/tags"
import {
  createNoteInput,
  listNotesInput,
  noteIdInput,
  notePublishingInput,
  setPinnedInput,
  updateNoteInput,
  type Note,
} from "./schema"

export const noteColumns = {
  id: notesNotes.id,
  title: notesNotes.title,
  body: notesNotes.body,
  pinned: notesNotes.pinned,
  isPublic: notesNotes.isPublic,
  slug: notesNotes.slug,
  excerpt: notesNotes.excerpt,
  publishedAt: notesNotes.publishedAt,
  updatedAt: notesNotes.updatedAt,
}

type Row = {
  id: string
  title: string
  body: string
  pinned: boolean
  isPublic: boolean
  slug: string | null
  excerpt: string
  publishedAt: Date | null
  updatedAt: Date
}

function toNote(row: Row): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    updated_at: row.updatedAt.toISOString(),
    isPublic: row.isPublic,
    slug: row.slug,
    excerpt: row.excerpt,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }
}

// The "read published" policy lets everyone see the site owner's published
// notes, so private queries must also say "only mine" (same as links, ideas).
const mine = eq(notesNotes.ownerId, sql`app.current_user_id()`)

export class NoteSlugTakenError extends Error {
  constructor() {
    super("Another published note already uses this address.")
  }
}

/** `base`, or `base-2`, `base-3`… whichever this owner hasn't used yet. */
async function freeSlug(tx: Tx, base: string, exceptId: string) {
  const rows = await tx
    .select({ slug: notesNotes.slug })
    .from(notesNotes)
    .where(and(mine, like(notesNotes.slug, `${base}%`), ne(notesNotes.id, exceptId)))
  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code === "23505" || e.cause?.code === "23505"
}

// Every action runs through asViewer(), so RLS scopes it to the signed-in user.
// The same definitions will back AI and MCP tools (phase 7).
export const actions = {
  list: defineAction({
    description:
      "List the user's notes, pinned first, then most recently edited. Optionally filter by text in the title or body, or by pinned state.",
    kind: "read",
    input: listNotesInput,
    handler: ({ limit, query, pinned }): Promise<Note[]> =>
      asViewer(async (tx) => {
        const pattern = query ? likeContains(query) : null
        const rows = await tx
          .select(noteColumns)
          .from(notesNotes)
          .where(
            and(
              mine,
              pattern ? or(ilike(notesNotes.title, pattern), ilike(notesNotes.body, pattern)) : undefined,
              pinned === undefined ? undefined : eq(notesNotes.pinned, pinned),
            ),
          )
          .orderBy(desc(notesNotes.pinned), desc(notesNotes.updatedAt))
          .limit(limit)
        return rows.map(toNote)
      }),
  }),
  get: defineAction({
    description: "Get one note by id, including its full body. Returns null if it doesn't exist.",
    kind: "read",
    input: noteIdInput,
    handler: ({ id }): Promise<Note | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(noteColumns).from(notesNotes).where(and(mine, eq(notesNotes.id, id)))
        return row ? toNote(row) : null
      }),
  }),
  create: defineAction({
    description: "Create a note with a title and an optional plain-text or markdown body.",
    kind: "write",
    input: createNoteInput,
    handler: (input): Promise<{ id: string; updatedAt: string }> =>
      asViewer(async (tx) => {
        // Idempotent with a client-made id: a retried offline note lands once.
        if (input.id) {
          const [existing] = await tx
            .select({ id: notesNotes.id, updatedAt: notesNotes.updatedAt })
            .from(notesNotes)
            .where(eq(notesNotes.id, input.id))
          if (existing) return { id: existing.id, updatedAt: existing.updatedAt.toISOString() }
        }
        // owner_id defaults to app.current_user_id(); RLS checks it matches.
        const [row] = await tx
          .insert(notesNotes)
          .values(input)
          .returning({ id: notesNotes.id, updatedAt: notesNotes.updatedAt })
        return { id: row!.id, updatedAt: row!.updatedAt.toISOString() }
      }),
  }),
  update: defineAction({
    description: "Replace a note's title and body. A published note changes on /writing too.",
    kind: "write",
    input: updateNoteInput,
    handler: ({ id, title, body }): Promise<{ updated_at: string; isPublic: boolean }> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .update(notesNotes)
          .set({ title, body })
          .where(and(mine, eq(notesNotes.id, id)))
          .returning({ updatedAt: notesNotes.updatedAt, isPublic: notesNotes.isPublic })
        if (!row) throw new Error("Note not found")
        return { updated_at: row.updatedAt.toISOString(), isPublic: row.isPublic }
      }),
  }),
  setPublishing: defineAction({
    description:
      "Publish a note on the public /writing page (and its RSS feed), or take it down. The address is derived from the title when empty; the date defaults to now on the first publish.",
    kind: "write",
    input: notePublishingInput,
    handler: ({ id, isPublic, slug, excerpt, publishedOn }): Promise<Note> =>
      asViewer(async (tx) => {
        const [current] = await tx.select(noteColumns).from(notesNotes).where(and(mine, eq(notesNotes.id, id)))
        if (!current) throw new Error("Note not found")
        // An address is kept once chosen, even while unpublished, so links survive a republish.
        const wanted = slug || current.slug || slugify(current.title) || "note"
        const nextSlug = slug ? slug : await freeSlug(tx, wanted, id)
        const publishedAt = publishedOn
          ? new Date(`${publishedOn}T12:00:00Z`)
          : (current.publishedAt ?? (isPublic ? new Date() : null))
        try {
          const [row] = await tx
            .update(notesNotes)
            .set({ isPublic, slug: nextSlug, excerpt, publishedAt })
            .where(and(mine, eq(notesNotes.id, id)))
            .returning(noteColumns)
          return toNote(row!)
        } catch (error) {
          if (isUniqueViolation(error)) throw new NoteSlugTakenError()
          throw error
        }
      }),
  }),
  setPinned: defineAction({
    description: "Pin a note to the top of the list and the dashboard, or unpin it.",
    kind: "write",
    input: setPinnedInput,
    handler: ({ id, pinned }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(notesNotes).set({ pinned }).where(and(mine, eq(notesNotes.id, id)))
      }),
  }),
  delete: defineAction({
    description: "Permanently delete one of the user's notes by id (a published note leaves /writing too).",
    kind: "write",
    input: noteIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(notesNotes).where(and(mine, eq(notesNotes.id, id)))
      }),
  }),
}
