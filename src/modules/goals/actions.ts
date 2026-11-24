import "server-only"
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { goalsGoals as g, goalsLinks as l } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { calendarDate } from "@/lib/time"
import { goalProgress } from "./lib/progress"
import {
  createGoalInput,
  goalIdInput,
  linkedGoalInput,
  linkGoalInput,
  listGoalsInput,
  logGoalProgressInput,
  reorderGoalsInput,
  setGoalProgressInput,
  setGoalStatusInput,
  updateGoalInput,
  type Goal,
  type GoalDetail,
  type GoalOption,
  type GoalProject,
  type GoalTask,
} from "./schema"

/** A message the UI can show as is. */
export class GoalInputError extends Error {}

/** The viewer's calendar year: a goal "for this year" depends on their zone. */
export async function viewerYear() {
  const viewer = await requireViewer()
  return calendarDate(new Date(), viewer.timezone).year
}

/** Tasks that count towards goal `goalId`: linked directly, or in a linked project. */
function countsTowards(goalId: SQL) {
  return sql`(
    t.id in (select x.task_id from goals_links x where x.goal_id = ${goalId} and x.task_id is not null)
    or t.project_id in (select x.project_id from goals_links x where x.goal_id = ${goalId} and x.project_id is not null)
  )`
}

// Drizzle renders a column inside select-list SQL unqualified ("id"), which a
// subquery over goals_links would read as its own id. Name the outer row explicitly.
const outerGoal = sql.raw(`"goals_goals"."id"`)

const columns = {
  id: g.id,
  year: g.year,
  title: g.title,
  why: g.why,
  targetValue: g.targetValue,
  targetUnit: g.targetUnit,
  currentValue: g.currentValue,
  status: g.status,
  sortOrder: g.sortOrder,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
  tasksDone: sql<number>`(select count(*)::int from tasks_tasks t where t.done_at is not null and ${countsTowards(outerGoal)})`,
  tasksTotal: sql<number>`(select count(*)::int from tasks_tasks t where ${countsTowards(outerGoal)})`,
  projectCount: sql<number>`(select count(*)::int from goals_links x where x.goal_id = ${outerGoal} and x.project_id is not null)`,
}

type Row = Omit<Goal, "progress" | "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date }

function toGoal(row: Row): Goal {
  return {
    ...row,
    progress: goalProgress(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Active goals first, then achieved, then dropped; the owner's order within each. */
const statusOrder = sql`array_position(array['active', 'done', 'dropped'], ${g.status})`

async function selectGoals(tx: Tx, where: SQL | undefined, limit = 100) {
  const rows = await tx
    .select(columns)
    .from(g)
    .where(where)
    .orderBy(desc(g.year), statusOrder, asc(g.sortOrder), asc(g.createdAt))
    .limit(limit)
  return rows.map(toGoal)
}

function isRlsViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === "42501" || e?.cause?.code === "42501"
}

export const actions = {
  list: defineAction({
    description:
      "List the user's goals for one year (default: the current year) with their progress: a measurable goal counts its own number (e.g. 12 of 20 books), otherwise the share of linked tasks done. Active goals first. Optionally filter by status or by text in the title or why.",
    kind: "read",
    input: listGoalsInput,
    handler: async ({ year, status, query, limit }): Promise<Goal[]> => {
      const forYear = year ?? (await viewerYear())
      const pattern = query ? likeContains(query) : null
      return asViewer((tx) =>
        selectGoals(
          tx,
          and(
            eq(g.year, forYear),
            status?.length ? inArray(g.status, status) : undefined,
            pattern ? or(ilike(g.title, pattern), ilike(g.why, pattern)) : undefined,
          ),
          limit,
        ),
      )
    },
  }),
  search: defineAction({
    description: "Find goals of any year by text in the title or why, newest year first.",
    kind: "read",
    input: z.object({ query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(50).default(10) }),
    handler: ({ query, limit }): Promise<Goal[]> =>
      asViewer((tx) => {
        const pattern = likeContains(query)
        return selectGoals(tx, or(ilike(g.title, pattern), ilike(g.why, pattern)), limit)
      }),
  }),
  years: defineAction({
    description: "The years the user has goals in, newest first, with how many goals each.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<{ year: number; count: number }[]> =>
      asViewer((tx) =>
        tx
          .select({ year: g.year, count: sql<number>`count(*)::int` })
          .from(g)
          .groupBy(g.year)
          .orderBy(desc(g.year)),
      ),
  }),
  get: defineAction({
    description:
      "Get one goal with its progress, the tasks that count towards it (linked directly or through a linked project; open ones first) and its linked projects. Returns null if it doesn't exist.",
    kind: "read",
    input: goalIdInput,
    handler: ({ id }): Promise<GoalDetail | null> =>
      asViewer(async (tx) => {
        const [goal] = await selectGoals(tx, eq(g.id, id), 1)
        if (!goal) return null
        const tasks = await tx.execute<{ id: string; title: string; done_at: Date | string | null; due_date: string | null; via_project: string | null }>(sql`
          select t.id, t.title, t.done_at, t.due_date::text as due_date,
            case when exists (select 1 from goals_links x where x.task_id = t.id and x.goal_id = ${id}) then null
                 else (select p.title from projects_projects p where p.id = t.project_id) end as via_project
          from tasks_tasks t
          where ${countsTowards(sql`${id}::uuid`)}
          order by t.done_at is not null, t.due_date asc nulls last, t.done_at desc, t.created_at
          limit 200`)
        const projects = await tx.execute<GoalProject>(sql`
          select p.id, p.title, p.status
          from goals_links x join projects_projects p on p.id = x.project_id
          where x.goal_id = ${id} and p.owner_id = app.current_user_id()
          order by p.title`)
        const goalTasks: GoalTask[] = tasks.map((t) => ({
          id: t.id,
          title: t.title,
          doneAt: t.done_at ? new Date(t.done_at).toISOString() : null,
          dueDate: t.due_date,
          viaProject: t.via_project,
        }))
        return { ...goal, tasks: goalTasks, projects: [...projects] }
      }),
  }),
  options: defineAction({
    description:
      "Goals a task or project can be linked to: active goals of the current year and later, plus achieved ones of the current year. For pickers.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<GoalOption[]> => {
      const year = await viewerYear()
      return asViewer((tx) =>
        tx
          .select({ id: g.id, title: g.title, year: g.year, status: g.status })
          .from(g)
          .where(or(and(eq(g.status, "active"), sql`${g.year} >= ${year}`), and(eq(g.year, year), eq(g.status, "done"))))
          .orderBy(asc(g.year), statusOrder, asc(g.sortOrder), asc(g.createdAt)),
      )
    },
  }),
  linkedGoal: defineAction({
    description: "The goal a task or a project counts towards, or null.",
    kind: "read",
    input: linkedGoalInput,
    handler: ({ taskId, projectId }): Promise<GoalOption | null> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .select({ id: g.id, title: g.title, year: g.year, status: g.status })
          .from(l)
          .innerJoin(g, eq(g.id, l.goalId))
          .where(taskId ? eq(l.taskId, taskId) : eq(l.projectId, projectId!))
        return row ?? null
      }),
  }),
  create: defineAction({
    description:
      "Set a goal for a year (default: the current year). Only the title is required. Give targetValue and targetUnit for a measurable goal (e.g. 20 books, 1000 km); without a target, progress comes from the tasks linked to it.",
    kind: "write",
    input: createGoalInput,
    handler: async ({ year, ...fields }): Promise<{ id: string; updatedAt: string }> => {
      const forYear = year ?? (await viewerYear())
      return asViewer(async (tx) => {
        const [max] = await tx
          .select({ max: sql<number>`coalesce(max(${g.sortOrder}), 0)` })
          .from(g)
          .where(eq(g.year, forYear))
        const [row] = await tx
          .insert(g)
          .values({ ...fields, year: forYear, sortOrder: Number(max?.max ?? 0) + 1 })
          .returning({ id: g.id, updatedAt: g.updatedAt })
        return { id: row!.id, updatedAt: row!.updatedAt.toISOString() }
      })
    },
  }),
  update: defineAction({
    description: "Replace a goal's title, why, year and target (targetValue null for a goal measured by its tasks).",
    kind: "write",
    input: updateGoalInput,
    handler: ({ id, ...fields }): Promise<{ updatedAt: string }> =>
      asViewer(async (tx) => {
        const [row] = await tx.update(g).set(fields).where(eq(g.id, id)).returning({ updatedAt: g.updatedAt })
        if (!row) throw new GoalInputError("That goal no longer exists.")
        return { updatedAt: row.updatedAt.toISOString() }
      }),
  }),
  setProgress: defineAction({
    description: "Set where a measurable goal stands now, e.g. 12 (books read so far).",
    kind: "write",
    input: setGoalProgressInput,
    handler: ({ id, value }): Promise<Goal> =>
      asViewer(async (tx) => {
        await tx.update(g).set({ currentValue: value }).where(eq(g.id, id))
        const [goal] = await selectGoals(tx, eq(g.id, id), 1)
        if (!goal) throw new GoalInputError("That goal no longer exists.")
        return goal
      }),
  }),
  logProgress: defineAction({
    description:
      "Add to a measurable goal's current value, e.g. by 1 after finishing a book or by 12.5 after a run (negative to correct). Never goes below zero.",
    kind: "write",
    input: logGoalProgressInput,
    handler: ({ id, by }): Promise<Goal> =>
      asViewer(async (tx) => {
        await tx
          .update(g)
          .set({ currentValue: sql`greatest(0, ${g.currentValue} + ${by})` })
          .where(eq(g.id, id))
        const [goal] = await selectGoals(tx, eq(g.id, id), 1)
        if (!goal) throw new GoalInputError("That goal no longer exists.")
        return goal
      }),
  }),
  setStatus: defineAction({
    description: "Mark a goal achieved (done), dropped, or active again.",
    kind: "write",
    input: setGoalStatusInput,
    handler: ({ id, status }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(g).set({ status }).where(eq(g.id, id))
      }),
  }),
  reorder: defineAction({
    description: "Put goals in the given order (most important first).",
    kind: "write",
    input: reorderGoalsInput,
    handler: ({ ids }): Promise<void> =>
      asViewer(async (tx) => {
        const values = sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )
        await tx.execute(sql`
          update goals_goals as x set sort_order = o.ord
          from unnest(array[${values}]) with ordinality as o(id, ord)
          where x.id = o.id`)
      }),
  }),
  link: defineAction({
    description:
      "Count a task or a project towards a goal (a project brings all its tasks), replacing any goal it had. goalId null unlinks it.",
    kind: "write",
    input: linkGoalInput,
    handler: ({ goalId, taskId, projectId }): Promise<{ goalId: string | null }> =>
      asViewer(async (tx) => {
        const target = taskId ? eq(l.taskId, taskId) : eq(l.projectId, projectId!)
        await tx.delete(l).where(target)
        if (!goalId) return { goalId: null }
        try {
          await tx.insert(l).values({ goalId, taskId: taskId ?? null, projectId: projectId ?? null })
        } catch (error) {
          if (isRlsViolation(error)) throw new GoalInputError("That goal, task or project isn't yours or no longer exists.")
          throw error
        }
        return { goalId }
      }),
  }),
  delete: defineAction({
    description: "Permanently delete one of the user's goals. Its tasks and projects stay; they just stop counting towards it.",
    kind: "write",
    input: goalIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(g).where(eq(g.id, id))
      }),
  }),
}

/** For Today: this year's goals that aren't dropped, in the owner's order. */
export function goalsForToday(year: number) {
  return asViewer((tx) => selectGoals(tx, and(eq(g.year, year), sql`${g.status} <> 'dropped'`), 8))
}
