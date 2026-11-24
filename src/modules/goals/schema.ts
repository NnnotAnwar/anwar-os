import { z } from "zod"
import { goalStatuses, type GoalStatus } from "@/db/schema/goals"

export { goalStatuses, type GoalStatus }

export const goalStatusLabels: Record<GoalStatus, string> = {
  active: "Active",
  done: "Achieved",
  dropped: "Dropped",
}

/** The page reads best with a handful; more still work. */
export const SUGGESTED_GOALS = 5

const year = z.number().int().min(2000).max(2100)
const amount = z.number().finite().min(0).max(1_000_000_000)

export const goalFields = {
  title: z.string().trim().min(1, "Give the goal a title.").max(120, "Keep the title under 120 characters."),
  why: z.string().trim().max(1000, "Keep the why under 1000 characters."),
  year,
  /** Null: progress comes from linked tasks instead. */
  targetValue: amount.positive("A target is more than zero.").nullable(),
  targetUnit: z.string().trim().max(30, "Keep the unit short, e.g. books or km."),
  currentValue: amount,
  status: z.enum(goalStatuses),
}

export const createGoalInput = z.object({
  title: goalFields.title,
  why: goalFields.why.default(""),
  /** Defaults to the viewer's current year. */
  year: year.optional(),
  targetValue: goalFields.targetValue.default(null),
  targetUnit: goalFields.targetUnit.default(""),
  currentValue: goalFields.currentValue.default(0),
})
export const updateGoalInput = z.object({
  id: z.uuid(),
  title: goalFields.title,
  why: goalFields.why,
  year: goalFields.year,
  targetValue: goalFields.targetValue,
  targetUnit: goalFields.targetUnit,
})
export const goalIdInput = z.object({ id: z.uuid() })
export const listGoalsInput = z.object({
  /** Defaults to the viewer's current year. */
  year: year.optional(),
  status: z.array(z.enum(goalStatuses)).optional(),
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(50),
})
export const setGoalProgressInput = z.object({ id: z.uuid(), value: amount })
export const logGoalProgressInput = z.object({
  id: z.uuid(),
  by: z.number().finite().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Log a step other than zero."),
})
export const setGoalStatusInput = z.object({ id: z.uuid(), status: z.enum(goalStatuses) })
export const reorderGoalsInput = z.object({ ids: z.array(z.uuid()).min(1).max(100) })
export const linkGoalInput = z
  .object({
    /** Null unlinks the task or project from whatever goal it had. */
    goalId: z.uuid().nullable(),
    taskId: z.uuid().optional(),
    projectId: z.uuid().optional(),
  })
  .refine((v) => (v.taskId ? 1 : 0) + (v.projectId ? 1 : 0) === 1, "Link either a task or a project.")
export const linkedGoalInput = z
  .object({ taskId: z.uuid().optional(), projectId: z.uuid().optional() })
  .refine((v) => (v.taskId ? 1 : 0) + (v.projectId ? 1 : 0) === 1, "Ask about either a task or a project.")

/** How the goal measures itself; see lib/progress.ts. */
export type GoalProgress =
  | { kind: "target"; current: number; target: number; unit: string; ratio: number }
  | { kind: "tasks"; done: number; total: number; ratio: number }
  | { kind: "none"; ratio: null }

export type Goal = {
  id: string
  year: number
  title: string
  why: string
  targetValue: number | null
  targetUnit: string
  currentValue: number
  status: GoalStatus
  sortOrder: number
  tasksDone: number
  tasksTotal: number
  projectCount: number
  progress: GoalProgress
  createdAt: string
  updatedAt: string
}

export type GoalTask = { id: string; title: string; doneAt: string | null; dueDate: string | null; viaProject: string | null }
export type GoalProject = { id: string; title: string; status: string }

export type GoalDetail = Goal & { tasks: GoalTask[]; projects: GoalProject[] }

export type GoalOption = { id: string; title: string; year: number; status: GoalStatus }
