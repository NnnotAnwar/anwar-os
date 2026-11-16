import "server-only"
import { and, asc, desc, eq, gt, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { runModuleAction } from "@/core/module-actions"
import type { Tx } from "@/db"
import { tasksLists as l, tasksTasks as t } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { addDays, formatIsoDate, wallClock, type LocalDate } from "@/modules/calendar/lib/zoned"
import { parseTask } from "./lib/parse"
import { nextDueIso } from "./lib/repeat"
import {
  createListInput,
  createTaskInput,
  listIdInput,
  listTasksInput,
  quickAddInput,
  renameListInput,
  reorderInput,
  scheduleInput,
  searchTasksInput,
  taskIdInput,
  UPCOMING_DAYS,
  updateTaskInput,
  type ProjectOption,
  type Task,
  type TaskList,
  type TasksData,
} from "./schema"

/** A message the UI can show as is (duplicate list name, missing task…). */
export class TaskInputError extends Error {}

const columns = {
  id: t.id,
  title: t.title,
  notes: t.notes,
  dueDate: t.dueDate,
  dueTime: t.dueTime,
  priority: t.priority,
  listId: t.listId,
  projectId: t.projectId,
  rrule: t.rrule,
  doneAt: t.doneAt,
  sortOrder: t.sortOrder,
  createdAt: t.createdAt,
}

type Row = Omit<Task, "doneAt" | "createdAt"> & { doneAt: Date | null; createdAt: Date }

function toTask(row: Row): Task {
  return {
    ...row,
    dueTime: row.dueTime ? row.dueTime.slice(0, 5) : null,
    doneAt: row.doneAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The viewer's calendar date: "today" depends on their zone, not the server's. */
async function viewerToday(): Promise<LocalDate> {
  const viewer = await requireViewer()
  const w = wallClock(new Date(), viewer.timezone)
  return { year: w.year, month: w.month, day: w.day }
}

const open = isNull(t.doneAt)
const byDue = [asc(t.dueDate), sql`${t.dueTime} asc nulls last`, asc(t.sortOrder), asc(t.createdAt)]

async function nextSortOrder(tx: Tx) {
  const [row] = await tx.select({ max: sql<number>`coalesce(max(${t.sortOrder}), 0)` }).from(t)
  return Number(row?.max ?? 0) + 1
}

async function listsWithCounts(tx: Tx): Promise<TaskList[]> {
  const rows = await tx
    .select({
      id: l.id,
      name: l.name,
      openCount: sql<number>`(select count(*)::int from tasks_tasks x where x.list_id = ${l.id} and x.done_at is null)`,
    })
    .from(l)
    .orderBy(asc(l.sortOrder), asc(sql`lower(${l.name})`))
  return rows
}

/** Finds a list by name (case-insensitive) or creates it. */
async function ensureList(tx: Tx, name: string) {
  const [existing] = await tx.select({ id: l.id }).from(l).where(sql`lower(${l.name}) = lower(${name})`)
  if (existing) return existing.id
  const [max] = await tx.select({ max: sql<number>`coalesce(max(${l.sortOrder}), 0)` }).from(l)
  const [row] = await tx
    .insert(l)
    .values({ name, sortOrder: Number(max?.max ?? 0) + 1 })
    .returning({ id: l.id })
  return row!.id
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === "23505" || e?.cause?.code === "23505"
}

async function insertTask(tx: Tx, input: z.infer<typeof createTaskInput>) {
  const { listName, ...fields } = input
  const listId = listName ? await ensureList(tx, listName) : (fields.listId ?? null)
  const [row] = await tx
    .insert(t)
    .values({
      title: fields.title,
      notes: fields.notes ?? "",
      dueDate: fields.dueDate ?? null,
      dueTime: fields.dueTime ?? null,
      priority: fields.priority ?? "none",
      listId,
      projectId: fields.projectId ?? null,
      rrule: fields.rrule ?? null,
      sortOrder: await nextSortOrder(tx),
    })
    .returning(columns)
  return toTask(row!)
}

export const actions = {
  view: defineAction({
    description:
      "Load one view of the user's tasks: today (overdue and due today), upcoming (the next 7 days), lists (open tasks in one list, or in no list when listId is null) or done (recently completed). Also returns the user's lists with open counts.",
    kind: "read",
    input: listTasksInput,
    handler: async ({ view, listId }): Promise<TasksData> => {
      const today = await viewerToday()
      const todayIso = formatIsoDate(today)
      const horizon = formatIsoDate(addDays(today, UPCOMING_DAYS))
      return asViewer(async (tx) => {
        let where: SQL | undefined
        let order = byDue
        switch (view) {
          case "today":
            where = and(open, lte(t.dueDate, todayIso))
            break
          case "upcoming":
            where = and(open, gt(t.dueDate, todayIso), lte(t.dueDate, horizon))
            break
          case "lists":
            where = and(open, listId ? eq(t.listId, listId) : isNull(t.listId))
            order = [asc(t.sortOrder), asc(t.createdAt)]
            break
          case "done":
            where = isNotNull(t.doneAt)
            order = [desc(t.doneAt)]
            break
        }
        const [rows, lists, counts] = await Promise.all([
          tx
            .select(columns)
            .from(t)
            .where(where)
            .orderBy(...order)
            .limit(view === "done" ? 200 : 1000),
          listsWithCounts(tx),
          tx
            .select({
              overdue: sql<number>`count(*) filter (where ${t.dueDate} < ${todayIso})::int`,
              today: sql<number>`count(*) filter (where ${t.dueDate} = ${todayIso})::int`,
              upcoming: sql<number>`count(*) filter (where ${t.dueDate} > ${todayIso} and ${t.dueDate} <= ${horizon})::int`,
              unlisted: sql<number>`count(*) filter (where ${t.listId} is null)::int`,
            })
            .from(t)
            .where(open),
        ])
        const c = counts[0]!
        return {
          view,
          today: todayIso,
          tasks: rows.map(toTask),
          lists,
          unlistedCount: c.unlisted,
          counts: { overdue: c.overdue, today: c.today, upcoming: c.upcoming },
          selectedListId: view === "lists" ? listId : null,
        }
      })
    },
  }),
  dueToday: defineAction({
    description: "The user's open tasks that are overdue or due today, overdue first, then by time.",
    kind: "read",
    input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
    handler: async ({ limit }): Promise<{ tasks: Task[]; total: number; today: string }> => {
      const today = formatIsoDate(await viewerToday())
      return asViewer(async (tx) => {
        const where = and(open, lte(t.dueDate, today))
        const [rows, [count]] = await Promise.all([
          tx.select(columns).from(t).where(where).orderBy(...byDue).limit(limit),
          tx.select({ n: sql<number>`count(*)::int` }).from(t).where(where),
        ])
        return { tasks: rows.map(toTask), total: count?.n ?? 0, today }
      })
    },
  }),
  counts: defineAction({
    description: "How many open tasks are overdue and how many are due today.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<{ overdue: number; today: number }> => {
      const today = formatIsoDate(await viewerToday())
      return asViewer(async (tx) => {
        const [row] = await tx
          .select({
            overdue: sql<number>`count(*) filter (where ${t.dueDate} < ${today})::int`,
            today: sql<number>`count(*) filter (where ${t.dueDate} = ${today})::int`,
          })
          .from(t)
          .where(open)
        return row ?? { overdue: 0, today: 0 }
      })
    },
  }),
  get: defineAction({
    description: "Get one task by id. Returns null if it doesn't exist.",
    kind: "read",
    input: taskIdInput,
    handler: ({ id }): Promise<Task | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(columns).from(t).where(eq(t.id, id))
        return row ? toTask(row) : null
      }),
  }),
  search: defineAction({
    description: "Find tasks whose title or notes contain the text, open ones first.",
    kind: "read",
    input: searchTasksInput,
    handler: ({ query, limit }): Promise<Task[]> =>
      asViewer(async (tx) => {
        const pattern = likeContains(query)
        const rows = await tx
          .select(columns)
          .from(t)
          .where(or(ilike(t.title, pattern), ilike(t.notes, pattern)))
          .orderBy(sql`${t.doneAt} is not null`, sql`${t.dueDate} asc nulls last`, desc(t.updatedAt))
          .limit(limit)
        return rows.map(toTask)
      }),
  }),
  lists: defineAction({
    description: "The user's task lists (areas such as University) with their open task counts.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<TaskList[]> => asViewer(listsWithCounts),
  }),
  projects: defineAction({
    description: "Projects a task can be linked to (id and title).",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<ProjectOption[]> => {
      try {
        const rows = await runModuleAction<{ id: string; title: string }[]>("projects", "list", { limit: 200 })
        return rows.map((p) => ({ id: p.id, title: p.title }))
      } catch {
        return []
      }
    },
  }),
  create: defineAction({
    description:
      "Create a task. Only the title is required. Dates are YYYY-MM-DD, times HH:MM (the user's local time), priority none/low/high, rrule an RRULE such as FREQ=MONTHLY (needs a due date). listName files it in that list, creating the list if needed.",
    kind: "write",
    input: createTaskInput,
    handler: (input): Promise<Task> => asViewer((tx) => insertTask(tx, input)),
  }),
  quickAdd: defineAction({
    description:
      "Add a task from natural language, e.g. \"Call the bank tomorrow 10:00 !high #University\" or \"Pay rent every month on 1st\". Understands dates, times, !priority, #list and repeats in English and Czech.",
    kind: "write",
    input: quickAddInput,
    handler: async ({ text, listId, dueToday }): Promise<Task> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const lists = await tx.select({ id: l.id, name: l.name }).from(l)
        const parsed = parseTask(text, today, lists.map((x) => x.name))
        if (!parsed.title) throw new TaskInputError("Add a few words for the task itself, not just the date.")
        const dueDate = parsed.dueDate ? formatIsoDate(parsed.dueDate) : dueToday ? formatIsoDate(today) : null
        const known = parsed.listExists ? lists.find((x) => x.name === parsed.list) : undefined
        return insertTask(tx, {
          title: parsed.title,
          dueDate,
          dueTime: parsed.dueTime
            ? `${String(parsed.dueTime.hour).padStart(2, "0")}:${String(parsed.dueTime.minute).padStart(2, "0")}`
            : null,
          priority: parsed.priority,
          rrule: parsed.rrule,
          listId: known?.id ?? (parsed.list ? null : listId),
          listName: parsed.list && !known ? parsed.list : undefined,
        })
      })
    },
  }),
  update: defineAction({
    description:
      "Change some of a task's fields (title, notes, due date and time, priority, list, project, repeat). Clearing the due date also clears its time and repeat.",
    kind: "write",
    input: updateTaskInput,
    handler: ({ id, ...fields }): Promise<Task> =>
      asViewer(async (tx) => {
        const patch: Partial<typeof t.$inferInsert> = { ...fields }
        if (fields.dueDate === null) Object.assign(patch, { dueTime: null, rrule: null })
        const [row] = await tx.update(t).set(patch).where(eq(t.id, id)).returning(columns)
        if (!row) throw new TaskInputError("That task no longer exists.")
        return toTask(row)
      }),
  }),
  schedule: defineAction({
    description: "Set or clear a task's due date (YYYY-MM-DD). Clearing it also clears the time and repeat.",
    kind: "write",
    input: scheduleInput,
    handler: ({ id, dueDate }): Promise<Task> => actions.update.handler({ id, dueDate }),
  }),
  complete: defineAction({
    description:
      "Mark a task done. A repeating task spawns its next occurrence (returned as nextId) and the done one stops repeating.",
    kind: "write",
    input: taskIdInput,
    handler: async ({ id }): Promise<{ nextId: string | null; nextDue: string | null }> => {
      const today = await viewerToday()
      return asViewer(async (tx) => {
        const [task] = await tx.select().from(t).where(and(eq(t.id, id), open)).for("update")
        if (!task) return { nextId: null, nextDue: null }
        const nextDue = task.rrule && task.dueDate ? nextDueIso(task.rrule, task.dueDate, today) : null
        await tx
          .update(t)
          .set({ doneAt: new Date(), ...(nextDue ? { rrule: null } : {}) })
          .where(eq(t.id, id))
        if (!nextDue) return { nextId: null, nextDue: null }
        const [next] = await tx
          .insert(t)
          .values({
            title: task.title,
            notes: task.notes,
            dueDate: nextDue,
            dueTime: task.dueTime,
            priority: task.priority,
            listId: task.listId,
            projectId: task.projectId,
            rrule: task.rrule,
            spawnedFrom: task.id,
            sortOrder: task.sortOrder,
          })
          .returning({ id: t.id })
        return { nextId: next!.id, nextDue }
      })
    },
  }),
  reopen: defineAction({
    description:
      "Mark a done task as not done. If completing it had spawned the next occurrence of a repeat, that occurrence is removed and the task repeats again.",
    kind: "write",
    input: taskIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        const [successor] = await tx
          .select({ id: t.id, rrule: t.rrule })
          .from(t)
          .where(and(eq(t.spawnedFrom, id), open))
        if (successor) await tx.delete(t).where(eq(t.id, successor.id))
        await tx
          .update(t)
          .set({ doneAt: null, ...(successor?.rrule ? { rrule: successor.rrule } : {}) })
          .where(eq(t.id, id))
      }),
  }),
  reorder: defineAction({
    description: "Put tasks in the given order (the order of a list).",
    kind: "write",
    input: reorderInput,
    handler: ({ ids }): Promise<void> =>
      asViewer(async (tx) => {
        const values = sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )
        await tx.execute(sql`
          update tasks_tasks as x set sort_order = o.ord
          from unnest(array[${values}]) with ordinality as o(id, ord)
          where x.id = o.id`)
      }),
  }),
  delete: defineAction({
    description: "Permanently delete one of the user's tasks by id.",
    kind: "write",
    input: taskIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(t).where(eq(t.id, id))
      }),
  }),
  createList: defineAction({
    description: "Create a task list (an area such as University). Names are unique, ignoring case.",
    kind: "write",
    input: createListInput,
    handler: ({ name }): Promise<{ id: string }> =>
      asViewer(async (tx) => {
        const [dupe] = await tx.select({ id: l.id }).from(l).where(sql`lower(${l.name}) = lower(${name})`)
        if (dupe) throw new TaskInputError(`You already have a list called “${name}”.`)
        return { id: await ensureList(tx, name) }
      }),
  }),
  renameList: defineAction({
    description: "Rename a task list.",
    kind: "write",
    input: renameListInput,
    handler: ({ id, name }): Promise<void> =>
      asViewer(async (tx) => {
        try {
          await tx.update(l).set({ name }).where(eq(l.id, id))
        } catch (error) {
          if (isUniqueViolation(error)) throw new TaskInputError(`You already have a list called “${name}”.`)
          throw error
        }
      }),
  }),
  deleteList: defineAction({
    description: "Delete a task list. Its tasks are kept and move to no list.",
    kind: "write",
    input: listIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(l).where(eq(l.id, id))
      }),
  }),
}
