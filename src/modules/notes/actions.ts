import "server-only"
import { and, desc, eq, ilike, or } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { notesNotes } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import {
  createNoteInput,
  listNotesInput,
  noteIdInput,
  setPinnedInput,
  updateNoteInput,
  type Note,
} from "./schema"

const columns = {
  id: notesNotes.id,
  title: notesNotes.title,
  body: notesNotes.body,
  pinned: notesNotes.pinned,
  updatedAt: notesNotes.updatedAt,
}

function toNote(row: { id: string; title: string; body: string; pinned: boolean; updatedAt: Date }): Note {
  return { id: row.id, title: row.title, body: row.body, pinned: row.pinned, updated_at: row.updatedAt.toISOString() }
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
          .select(columns)
          .from(notesNotes)
          .where(
            and(
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
        const [row] = await tx.select(columns).from(notesNotes).where(eq(notesNotes.id, id))
        return row ? toNote(row) : null
      }),
  }),
  create: defineAction({
    description: "Create a note with a title and an optional plain-text or markdown body.",
    kind: "write",
    input: createNoteInput,
    handler: (input): Promise<{ id: string; updatedAt: string }> =>
      asViewer(async (tx) => {
        // owner_id defaults to app.current_user_id(); RLS checks it matches.
        const [row] = await tx
          .insert(notesNotes)
          .values(input)
          .returning({ id: notesNotes.id, updatedAt: notesNotes.updatedAt })
        return { id: row!.id, updatedAt: row!.updatedAt.toISOString() }
      }),
  }),
  update: defineAction({
    description: "Replace a note's title and body.",
    kind: "write",
    input: updateNoteInput,
    handler: ({ id, title, body }): Promise<{ updated_at: string }> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .update(notesNotes)
          .set({ title, body })
          .where(eq(notesNotes.id, id))
          .returning({ updatedAt: notesNotes.updatedAt })
        if (!row) throw new Error("Note not found")
        return { updated_at: row.updatedAt.toISOString() }
      }),
  }),
  setPinned: defineAction({
    description: "Pin a note to the top of the list and the dashboard, or unpin it.",
    kind: "write",
    input: setPinnedInput,
    handler: ({ id, pinned }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(notesNotes).set({ pinned }).where(eq(notesNotes.id, id))
      }),
  }),
  delete: defineAction({
    description: "Permanently delete one of the user's notes by id.",
    kind: "write",
    input: noteIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(notesNotes).where(eq(notesNotes.id, id))
      }),
  }),
}
