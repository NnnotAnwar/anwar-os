import "server-only"
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { runModuleAction } from "@/core/module-actions"
import { inboxItems as i } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { parseQuickAdd } from "@/modules/calendar/lib/quick-add"
import { formatIsoDate, formatTime, wallClock } from "@/modules/calendar/lib/zoned"
import { splitCapture, titleAndBody } from "./lib/extract"
import {
  captureInput,
  inboxIdInput,
  listInboxInput,
  processInput,
  updateInboxInput,
  type InboxItem,
  type InboxOutcome,
  type ProcessResult,
} from "./schema"

/** A message the UI can show as is. */
export class InboxInputError extends Error {}

const columns = {
  id: i.id,
  text: i.text,
  url: i.url,
  source: i.source,
  processedAt: i.processedAt,
  processedAs: i.processedAs,
  processedRef: i.processedRef,
  createdAt: i.createdAt,
}

type Row = Omit<InboxItem, "processedAt" | "createdAt"> & { processedAt: Date | null; createdAt: Date }

function toItem(row: Row): InboxItem {
  return { ...row, processedAt: row.processedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }
}

const open = isNull(i.processedAt)

/** The body other modules get: the text after the title, then the link. */
function bodyWith(body: string, url: string | null) {
  return [body, url].filter(Boolean).join("\n\n")
}

/** Creates the entity an item becomes, through the owning module's own action. */
async function createFrom(outcome: InboxOutcome, text: string, url: string | null): Promise<Omit<ProcessResult, "outcome">> {
  switch (outcome) {
    case "task": {
      const { title, body } = titleAndBody(text || url || "", 300)
      // The tasks parser reads "tomorrow 10:00 !high #University" from the title.
      const task = await runModuleAction<{ id: string; title: string }>("tasks", "quickAdd", { text: title })
      const notes = bodyWith(body, url)
      if (notes) await runModuleAction("tasks", "update", { id: task.id, notes })
      return { ref: task.id, href: `/app/tasks?task=${task.id}`, title: task.title }
    }
    case "note": {
      const { title, body } = titleAndBody(text || url || "", 200)
      const note = await runModuleAction<{ id: string }>("notes", "create", { title, body: bodyWith(body, url) })
      return { ref: note.id, href: `/app/notes/${note.id}`, title }
    }
    case "idea": {
      const { title, body } = titleAndBody(text || url || "", 200)
      const idea = await runModuleAction<{ id: string }>("ideas", "create", { title, body: bodyWith(body, url) })
      return { ref: idea.id, href: `/app/ideas/${idea.id}`, title }
    }
    case "link": {
      if (!url) throw new InboxInputError("There's no link in this item — add one, or make it a note.")
      const link = await runModuleAction<{ id: string; title: string; duplicate: boolean }>("links", "create", {
        url,
        note: text.slice(0, 5000),
      })
      // An already-saved link isn't ours to delete on Undo: keep no reference.
      return { ref: link.duplicate ? "" : link.id, href: `/app/links/${link.id}`, title: link.title }
    }
    case "event": {
      const viewer = await requireViewer()
      const now = wallClock(new Date(), viewer.timezone)
      const { title: line, body } = titleAndBody(text || url || "", 200)
      const draft = parseQuickAdd(line, now)
      if (!draft) throw new InboxInputError("Give the event a name, e.g. “Dentist fri 14:00”.")
      const date = formatIsoDate(draft.date)
      const event = await runModuleAction<{ id: string }>("calendar", "create", {
        title: draft.title,
        notes: bodyWith(body, url),
        allDay: !draft.time,
        startDate: date,
        endDate: date,
        startTime: draft.time ? formatTime(draft.time.start) : undefined,
        endTime: draft.time ? formatTime(draft.time.end) : undefined,
        timezone: viewer.timezone,
      })
      return { ref: event.id, href: `/app/calendar?event=${event.id}`, title: draft.title }
    }
  }
}

const deleters: Record<InboxOutcome, [string, string]> = {
  task: ["tasks", "delete"],
  note: ["notes", "delete"],
  idea: ["ideas", "delete"],
  link: ["links", "delete"],
  event: ["calendar", "delete"],
}

export const actions = {
  list: defineAction({
    description:
      "List inbox items. By default the unprocessed ones, oldest first (the order to process them in); with processed: true, the recently processed ones, newest first.",
    kind: "read",
    input: listInboxInput,
    handler: ({ processed, limit }): Promise<InboxItem[]> =>
      asViewer(async (tx) => {
        const rows = await tx
          .select(columns)
          .from(i)
          .where(processed ? isNotNull(i.processedAt) : open)
          .orderBy(processed ? desc(i.processedAt) : asc(i.createdAt))
          .limit(limit)
        return rows.map(toItem)
      }),
  }),
  count: defineAction({
    description: "How many inbox items are waiting to be processed.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<number> =>
      asViewer(async (tx) => {
        const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(i).where(open)
        return row?.n ?? 0
      }),
  }),
  search: defineAction({
    description: "Find unprocessed inbox items whose text or link contains the query.",
    kind: "read",
    input: z.object({ query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(50).default(10) }),
    handler: ({ query, limit }): Promise<InboxItem[]> =>
      asViewer(async (tx) => {
        const pattern = likeContains(query)
        const rows = await tx
          .select(columns)
          .from(i)
          .where(and(open, or(ilike(i.text, pattern), ilike(i.url, pattern))))
          .orderBy(desc(i.createdAt))
          .limit(limit)
        return rows.map(toItem)
      }),
  }),
  capture: defineAction({
    description:
      "Capture anything into the inbox to sort later: a thought, a to-do, a link. A URL inside the text is pulled out as the item's link.",
    kind: "write",
    input: captureInput,
    handler: ({ id, text, url, source }): Promise<InboxItem> =>
      asViewer(async (tx) => {
        // Idempotent with a client-made id: a retried offline capture lands once.
        if (id) {
          const [existing] = await tx.select(columns).from(i).where(eq(i.id, id))
          if (existing) return toItem(existing)
        }
        const split = splitCapture(text, url)
        const [row] = await tx.insert(i).values({ id, text: split.text, url: split.url, source }).returning(columns)
        return toItem(row!)
      }),
  }),
  update: defineAction({
    description: "Change an inbox item's text before processing it.",
    kind: "write",
    input: updateInboxInput,
    handler: ({ id, text }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(i).set({ text: text.trim() }).where(eq(i.id, id))
      }),
  }),
  process: defineAction({
    description:
      "Turn an inbox item into a task, note, link, idea or event (created through that module) and mark it processed. Tasks understand dates like “tomorrow 10:00”; events need a day or time in the text.",
    kind: "write",
    input: processInput,
    handler: async ({ id, as, text }): Promise<ProcessResult> => {
      const [item] = await asViewer((tx) => tx.select(columns).from(i).where(and(eq(i.id, id), open)))
      if (!item) throw new InboxInputError("That item was already processed.")
      const source = text !== undefined ? text.trim() : item.text
      if (!source && !item.url) throw new InboxInputError("This item is empty — write something first.")
      const created = await createFrom(as, source, item.url)
      await asViewer((tx) =>
        tx
          .update(i)
          .set({ processedAt: new Date(), processedAs: as, processedRef: created.ref || null, text: source })
          .where(eq(i.id, id)),
      )
      return { outcome: as, ...created }
    },
  }),
  unprocess: defineAction({
    description: "Undo processing: put the item back in the inbox and delete what it was turned into.",
    kind: "write",
    input: inboxIdInput,
    handler: async ({ id }): Promise<void> => {
      const [item] = await asViewer((tx) => tx.select(columns).from(i).where(eq(i.id, id)))
      if (!item?.processedAs) return
      if (item.processedRef) {
        const [moduleId, name] = deleters[item.processedAs]
        await runModuleAction(moduleId, name, { id: item.processedRef }).catch(() => undefined)
      }
      await asViewer((tx) =>
        tx.update(i).set({ processedAt: null, processedAs: null, processedRef: null }).where(eq(i.id, id)),
      )
    },
  }),
  delete: defineAction({
    description: "Permanently delete an inbox item.",
    kind: "write",
    input: inboxIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(i).where(eq(i.id, id))
      }),
  }),
}
