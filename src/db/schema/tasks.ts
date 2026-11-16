import { sql } from "drizzle-orm"
import {
  check,
  date,
  doublePrecision,
  index,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { user } from "./auth"
import { projectsProjects } from "./projects"

export const taskPriorities = ["none", "low", "high"] as const
export type TaskPriority = (typeof taskPriorities)[number]

// Module: tasks. RLS (including "a task can only point at your own list,
// project and predecessor"), triggers and grants live in db/modules/tasks.sql;
// Drizzle only describes the shape.

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/** User-defined lists ("University", "Planuj Směny"). Names are unique per owner, ignoring case. */
export const tasksLists = pgTable(
  "tasks_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tasks_lists_owner_name_key").on(t.ownerId, sql`lower(${t.name})`),
    index("tasks_lists_owner_order_idx").on(t.ownerId, t.sortOrder),
    check("tasks_lists_name_length", sql`char_length(${t.name}) between 1 and 60`),
  ],
)

/**
 * A to-do. `due_date` is a floating calendar date (no zone); `due_time` is an
 * optional wall-clock time on that date. `rrule` reuses the calendar's RRULE
 * subset (modules/calendar/lib/recurrence.ts): completing a repeating task
 * marks it done and spawns the next one (`spawned_from` points back), so the
 * Done list keeps a history and Undo can remove the successor.
 */
export const tasksTasks = pgTable(
  "tasks_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: time("due_time"),
    priority: text("priority").$type<TaskPriority>().notNull().default("none"),
    listId: uuid("list_id").references(() => tasksLists.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projectsProjects.id, { onDelete: "set null" }),
    rrule: text("rrule"),
    spawnedFrom: uuid("spawned_from").references((): AnyPgColumn => tasksTasks.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("tasks_tasks_owner_open_due_idx").on(t.ownerId, t.dueDate).where(sql`${t.doneAt} is null`),
    index("tasks_tasks_owner_list_order_idx").on(t.ownerId, t.listId, t.sortOrder),
    index("tasks_tasks_owner_done_idx").on(t.ownerId, t.doneAt.desc()),
    index("tasks_tasks_spawned_from_idx").on(t.spawnedFrom),
    check("tasks_tasks_title_length", sql`char_length(${t.title}) between 1 and 300`),
    check("tasks_tasks_notes_length", sql`char_length(${t.notes}) <= 20000`),
    check("tasks_tasks_priority_valid", sql`${t.priority} in ('none', 'low', 'high')`),
    check("tasks_tasks_rrule_length", sql`char_length(${t.rrule}) <= 300`),
    check("tasks_tasks_time_needs_date", sql`${t.dueTime} is null or ${t.dueDate} is not null`),
    check("tasks_tasks_repeat_needs_date", sql`${t.rrule} is null or ${t.dueDate} is not null`),
  ],
)
