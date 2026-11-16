"use server"

import { refresh } from "next/cache"
import type { z } from "zod"
import { actions, TaskInputError } from "./actions"
import {
  createListInput,
  listIdInput,
  quickAddInput,
  renameListInput,
  reorderInput,
  scheduleInput,
  taskIdInput,
  updateTaskInput,
  type ProjectOption,
  type Task,
} from "./schema"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
  fallback: string,
  { reload = true } = {},
): Promise<Result<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? fallback }
  try {
    const value = await fn(parsed.data)
    // Re-render whatever page called this (the tasks page, or Today's widget).
    if (reload) refresh()
    return { ok: true, value }
  } catch (error) {
    if (error instanceof TaskInputError) return { ok: false, error: error.message }
    console.error("tasks action failed", error)
    return { ok: false, error: fallback }
  }
}

export async function quickAddTask(input: unknown): Promise<Result<Task>> {
  return run(quickAddInput, input, (d) => actions.quickAdd.handler(d), "The task wasn't added. Check your connection and try again.")
}

export async function updateTask(input: unknown): Promise<Result<Task>> {
  return run(updateTaskInput, input, (d) => actions.update.handler(d), "Changes weren't saved. Try again.")
}

export async function scheduleTask(input: unknown): Promise<Result<Task>> {
  return run(scheduleInput, input, (d) => actions.schedule.handler(d), "The date wasn't changed. Try again.")
}

export async function completeTask(input: unknown) {
  return run(taskIdInput, input, (d) => actions.complete.handler(d), "The task wasn't completed. Try again.")
}

export async function reopenTask(input: unknown) {
  return run(taskIdInput, input, (d) => actions.reopen.handler(d), "The task wasn't restored. Try again.")
}

export async function deleteTask(input: unknown) {
  return run(taskIdInput, input, (d) => actions.delete.handler(d), "The task wasn't deleted. Try again.")
}

export async function reorderTasks(input: unknown) {
  return run(reorderInput, input, (d) => actions.reorder.handler(d), "The new order wasn't saved. Try again.")
}

export async function getTask(input: unknown): Promise<Result<Task | null>> {
  return run(taskIdInput, input, (d) => actions.get.handler(d), "The task couldn't be loaded.", { reload: false })
}

export async function getProjectOptions(): Promise<ProjectOption[]> {
  return actions.projects.handler({})
}

export async function createList(input: unknown) {
  return run(createListInput, input, (d) => actions.createList.handler(d), "The list wasn't created. Try again.")
}

export async function renameList(input: unknown) {
  return run(renameListInput, input, (d) => actions.renameList.handler(d), "The list wasn't renamed. Try again.")
}

export async function deleteList(input: unknown) {
  return run(listIdInput, input, (d) => actions.deleteList.handler(d), "The list wasn't deleted. Try again.")
}
