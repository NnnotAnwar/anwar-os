"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { runModuleAction } from "@/core/module-actions"
import { TaskInputError } from "@/modules/tasks/actions"
import { actions, GoalInputError } from "./actions"
import {
  createGoalInput,
  goalIdInput,
  linkedGoalInput,
  linkGoalInput,
  logGoalProgressInput,
  reorderGoalsInput,
  setGoalProgressInput,
  setGoalStatusInput,
  updateGoalInput,
  type Goal,
  type GoalOption,
  type GoalStatus,
} from "./schema"

export type GoalSaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string }
export type GoalResult = { ok: true; goal: Goal } | { ok: false; error: string }

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the goal and try again."
}

/** Goals show on their own page, on Today and in the task and project editors. */
function changed() {
  revalidatePath("/app/goals")
  revalidatePath("/app")
}

/** The editor's autosave: creates on the first save (id null), then updates. */
export async function saveGoal(id: string | null, input: unknown): Promise<GoalSaveResult> {
  try {
    if (!id) {
      const parsed = createGoalInput.safeParse(input)
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
      const created = await actions.create.handler(parsed.data)
      changed()
      return { ok: true, ...created }
    }
    const parsed = updateGoalInput.safeParse({ ...(input as object), id })
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
    const { updatedAt } = await actions.update.handler(parsed.data)
    changed()
    return { ok: true, id, updatedAt }
  } catch (error) {
    if (error instanceof GoalInputError) return { ok: false, error: error.message }
    return { ok: false, error: "Changes weren't saved. Check your connection; they retry on the next edit." }
  }
}

/** Quick add from the goals page: a title for the year on screen. */
export async function quickAddGoal(input: { title: string; year: number }): Promise<GoalSaveResult> {
  const parsed = createGoalInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const created = await actions.create.handler(parsed.data)
    changed()
    return { ok: true, ...created }
  } catch {
    return { ok: false, error: "The goal wasn't added. Check your connection and try again." }
  }
}

export async function setGoalProgress(input: { id: string; value: number }): Promise<GoalResult> {
  const parsed = setGoalProgressInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const goal = await actions.setProgress.handler(parsed.data)
    changed()
    return { ok: true, goal }
  } catch {
    return { ok: false, error: "Progress wasn't saved. Check your connection and try again." }
  }
}

export async function logGoalProgress(input: { id: string; by: number }): Promise<GoalResult> {
  const parsed = logGoalProgressInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const goal = await actions.logProgress.handler(parsed.data)
    changed()
    return { ok: true, goal }
  } catch {
    return { ok: false, error: "Progress wasn't saved. Check your connection and try again." }
  }
}

export async function setGoalStatus(input: { id: string; status: GoalStatus }) {
  const parsed = setGoalStatusInput.safeParse(input)
  if (!parsed.success) return
  await actions.setStatus.handler(parsed.data)
  changed()
}

export async function reorderGoals(input: { ids: string[] }) {
  const parsed = reorderGoalsInput.safeParse(input)
  if (!parsed.success) return
  await actions.reorder.handler(parsed.data)
  changed()
}

/** Called when the Undo toast expires, so a mistaken delete costs nothing. */
export async function deleteGoal(input: { id: string }) {
  const parsed = goalIdInput.safeParse(input)
  if (!parsed.success) return
  await actions.delete.handler(parsed.data)
  changed()
}

/** From the detail page: delete and go back to the list. */
export async function deleteGoalAndReturn(input: { id: string }) {
  await deleteGoal(input)
  redirect("/app/goals")
}

/** For the task and project editors: what it can link to and what it's linked to now. */
export async function getGoalPicker(input: { taskId?: string; projectId?: string }): Promise<{
  options: GoalOption[]
  current: GoalOption | null
}> {
  const parsed = linkedGoalInput.safeParse(input)
  if (!parsed.success) return { options: [], current: null }
  const [options, current] = await Promise.all([actions.options.handler({}), actions.linkedGoal.handler(parsed.data)])
  return { options, current }
}

export async function linkToGoal(input: {
  goalId: string | null
  taskId?: string
  projectId?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = linkGoalInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    await actions.link.handler(parsed.data)
    changed()
    return { ok: true }
  } catch (error) {
    if (error instanceof GoalInputError) return { ok: false, error: error.message }
    return { ok: false, error: "The goal wasn't changed. Check your connection and try again." }
  }
}

const addTaskInput = z.object({
  goalId: z.uuid(),
  text: z.string().trim().min(1, "Write the task first — a few words are enough.").max(500),
})

/** From the goal page: a task in plain words ("Book the race tomorrow"), counted towards the goal. */
export async function addTaskToGoal(input: { goalId: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = addTaskInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  try {
    const task = await runModuleAction<{ id: string }>("tasks", "quickAdd", { text: parsed.data.text })
    await actions.link.handler({ goalId: parsed.data.goalId, taskId: task.id })
    changed()
    revalidatePath("/app/tasks")
    return { ok: true }
  } catch (error) {
    if (error instanceof GoalInputError) return { ok: false, error: error.message }
    if (error instanceof TaskInputError) return { ok: false, error: error.message }
    return { ok: false, error: "The task wasn't added. Check your connection and try again." }
  }
}
