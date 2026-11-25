// Inputs and shared types for tasks. Client-safe: no server imports.
import { z } from "zod"
import { taskPriorities, type TaskPriority } from "@/db/schema/tasks"
import { parseIsoDate, parseTime } from "@/modules/calendar/lib/zoned"
import { isTaskRRule } from "./lib/repeat"

export { taskPriorities, type TaskPriority }

export const priorityLabels: Record<TaskPriority, string> = { none: "None", low: "Low", high: "High" }

export const taskViews = ["today", "upcoming", "lists", "done"] as const
export type TaskView = (typeof taskViews)[number]
export const viewLabels: Record<TaskView, string> = { today: "Today", upcoming: "Upcoming", lists: "Lists", done: "Done" }

/** Days the Upcoming view covers after today. */
export const UPCOMING_DAYS = 7

const isoDate = z.string().refine((v) => parseIsoDate(v) !== null, "Pick a valid date.")
const clock = z.string().refine((v) => parseTime(v) !== null, "Use a 24-hour time like 09:30.")
const rrule = z.string().max(300).refine(isTaskRRule, "That repeat isn't supported.")

const title = z.string().trim().min(1, "Give the task a title.").max(300, "Keep the title under 300 characters.")
const listName = z.string().trim().min(1, "Name the list.").max(60, "Keep the list name under 60 characters.")

export const taskFields = z.object({
  title,
  notes: z.string().max(20_000, "These notes are too long to save."),
  dueDate: isoDate.nullable(),
  dueTime: clock.nullable(),
  priority: z.enum(taskPriorities),
  listId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  rrule: rrule.nullable(),
})

function dateRules<T extends { dueDate?: string | null; dueTime?: string | null; rrule?: string | null }>(v: T, ctx: z.RefinementCtx) {
  if (v.dueTime && !v.dueDate) ctx.addIssue({ code: "custom", message: "Pick a date for that time.", path: ["dueDate"] })
  if (v.rrule && !v.dueDate) ctx.addIssue({ code: "custom", message: "A repeating task needs a date.", path: ["dueDate"] })
}

export const createTaskInput = taskFields
  .partial()
  .extend({ title, listName: listName.optional() })
  .superRefine(dateRules)
export const updateTaskInput = taskFields.partial().extend({ id: z.uuid() }).superRefine(dateRules)
export const taskIdInput = z.object({ id: z.uuid() })
export const quickAddInput = z.object({
  /** Optional id made by the client: adding again with the same id returns the first task (offline retries). */
  id: z.uuid().optional(),
  text: z.string().trim().min(1, "Write the task first — a few words are enough.").max(500),
  /** The day the text was written, which "tomorrow" counts from (captured offline); default: today. */
  today: isoDate.optional(),
  /** The list to file it in when the text names none (the list being viewed). */
  listId: z.uuid().nullable().default(null),
  /** Give undated tasks today's date (adding from the Today view). */
  dueToday: z.boolean().default(false),
})
export const scheduleInput = z.object({ id: z.uuid(), dueDate: isoDate.nullable() })
export const dueBetweenInput = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: "The range ends before it starts.", path: ["to"] })
export const reorderInput = z.object({ ids: z.array(z.uuid()).min(1).max(1000) })
export const searchTasksInput = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(10),
})
export const listTasksInput = z.object({
  view: z.enum(taskViews),
  /** Lists view: a list id, or null for tasks in no list. */
  listId: z.uuid().nullable().default(null),
})
export const createListInput = z.object({ name: listName })
export const renameListInput = z.object({ id: z.uuid(), name: listName })
export const listIdInput = z.object({ id: z.uuid() })

export type Task = {
  id: string
  title: string
  notes: string
  /** "2026-11-17" */
  dueDate: string | null
  /** "10:00" */
  dueTime: string | null
  priority: TaskPriority
  listId: string | null
  projectId: string | null
  rrule: string | null
  doneAt: string | null
  sortOrder: number
  createdAt: string
}

export type TaskList = { id: string; name: string; openCount: number }
export type ProjectOption = { id: string; title: string }

/** Everything the tasks page renders for one view. */
export type TasksData = {
  view: TaskView
  today: string
  tasks: Task[]
  lists: TaskList[]
  /** Open tasks in no list (Lists view sidebar). */
  unlistedCount: number
  counts: { overdue: number; today: number; upcoming: number }
  selectedListId: string | null
}
