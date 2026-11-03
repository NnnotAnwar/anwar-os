import "server-only"
import { defineAction } from "@/core/module"
import { createClient } from "@/lib/supabase/server"
import { ilikeContains } from "@/lib/postgrest"
import {
  createNoteInput,
  listNotesInput,
  noteIdInput,
  setPinnedInput,
  updateNoteInput,
  type Note,
} from "./schema"

const COLUMNS = "id, title, body, pinned, updated_at"

// Module actions use the request-scoped client, so RLS scopes every call to the
// signed-in user. The same definitions will back AI and MCP tools (phase 4).
export const actions = {
  list: defineAction({
    description:
      "List the user's notes, pinned first, then most recently edited. Optionally filter by text in the title or body, or by pinned state.",
    kind: "read",
    input: listNotesInput,
    async handler({ limit, query, pinned }): Promise<Note[]> {
      const supabase = await createClient()
      let request = supabase
        .from("notes_notes")
        .select(COLUMNS)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit)
      if (query) {
        const pattern = ilikeContains(query)
        request = request.or(`title.ilike.${pattern},body.ilike.${pattern}`)
      }
      if (pinned !== undefined) request = request.eq("pinned", pinned)
      const { data, error } = await request
      if (error) throw error
      return data
    },
  }),
  get: defineAction({
    description: "Get one note by id, including its full body. Returns null if it doesn't exist.",
    kind: "read",
    input: noteIdInput,
    async handler({ id }): Promise<Note | null> {
      const supabase = await createClient()
      const { data, error } = await supabase.from("notes_notes").select(COLUMNS).eq("id", id).maybeSingle()
      if (error) throw error
      return data
    },
  }),
  create: defineAction({
    description: "Create a note with a title and an optional plain-text or markdown body.",
    kind: "write",
    input: createNoteInput,
    async handler(input): Promise<{ id: string }> {
      const supabase = await createClient()
      const { data, error } = await supabase.from("notes_notes").insert(input).select("id").single()
      if (error) throw error
      return data
    },
  }),
  update: defineAction({
    description: "Replace a note's title and body.",
    kind: "write",
    input: updateNoteInput,
    async handler({ id, title, body }): Promise<{ updated_at: string }> {
      const supabase = await createClient()
      const { data, error } = await supabase
        .from("notes_notes")
        .update({ title, body })
        .eq("id", id)
        .select("updated_at")
        .single()
      if (error) throw error
      return data
    },
  }),
  setPinned: defineAction({
    description: "Pin a note to the top of the list and the dashboard, or unpin it.",
    kind: "write",
    input: setPinnedInput,
    async handler({ id, pinned }): Promise<void> {
      const supabase = await createClient()
      const { error } = await supabase.from("notes_notes").update({ pinned }).eq("id", id)
      if (error) throw error
    },
  }),
  delete: defineAction({
    description: "Permanently delete one of the user's notes by id.",
    kind: "write",
    input: noteIdInput,
    async handler({ id }): Promise<void> {
      const supabase = await createClient()
      const { error } = await supabase.from("notes_notes").delete().eq("id", id)
      if (error) throw error
    },
  }),
}
