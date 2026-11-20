"use server"

import { refresh, revalidatePath } from "next/cache"
import { z } from "zod"
import { actions } from "./actions"
import {
  archiveInput,
  BudgetInputError,
  createAccountInput,
  createCategoryInput,
  createGoalInput,
  createRecurringInput,
  createTransactionInput,
  existingKeysInput,
  idInput,
  idsInput,
  importInput,
  planInput,
  quickAddInput,
  setActiveInput,
  transferInput,
  updateAccountInput,
  updateCategoryInput,
  updateGoalInput,
  updateRecurringInput,
  updateTransactionInput,
  type Transaction,
} from "./schema"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
  fallback: string,
): Promise<Result<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? fallback }
  try {
    const value = await fn(parsed.data)
    return { ok: true, value }
  } catch (error) {
    if (error instanceof BudgetInputError) return { ok: false, error: error.message }
    console.error("budget action failed", error)
    return { ok: false, error: fallback }
  }
}

/** Every budget page reads the same tables, so any write refreshes them all (and Today's widget). */
function changed() {
  revalidatePath("/app/budget", "layout")
  revalidatePath("/app")
  refresh()
}

async function write<S extends z.ZodType, T>(schema: S, input: unknown, fn: (d: z.output<S>) => Promise<T>, fallback: string) {
  const result = await run(schema, input, fn, fallback)
  if (result.ok) changed()
  return result
}

const SAVE = "That wasn't saved. Check your connection and try again."

export const quickAdd = async (input: unknown): Promise<Result<Transaction>> =>
  write(quickAddInput, input, (d) => actions.quickAdd.handler(d), SAVE)
export const createTransaction = async (input: unknown) =>
  write(createTransactionInput, input, (d) => actions.createTransaction.handler(d), SAVE)
export const updateTransaction = async (input: unknown) =>
  write(updateTransactionInput, input, (d) => actions.updateTransaction.handler(d), SAVE)
export const deleteTransactions = async (input: unknown) =>
  write(idsInput, input, (d) => actions.deleteTransactions.handler(d), "That wasn't deleted. Try again.")
export const createTransfer = async (input: unknown) => write(transferInput, input, (d) => actions.transfer.handler(d), SAVE)

export const createAccount = async (input: unknown) => write(createAccountInput, input, (d) => actions.createAccount.handler(d), SAVE)
export const updateAccount = async (input: unknown) => write(updateAccountInput, input, (d) => actions.updateAccount.handler(d), SAVE)
export const archiveAccount = async (input: unknown) => write(archiveInput, input, (d) => actions.archiveAccount.handler(d), SAVE)
export const deleteAccount = async (input: unknown) =>
  write(idInput, input, (d) => actions.deleteAccount.handler(d), "The account wasn't deleted. Try again.")

export const createCategory = async (input: unknown) =>
  write(createCategoryInput, input, (d) => actions.createCategory.handler(d), SAVE)
export const updateCategory = async (input: unknown) =>
  write(updateCategoryInput, input, (d) => actions.updateCategory.handler(d), SAVE)
export const archiveCategory = async (input: unknown) => write(archiveInput, input, (d) => actions.archiveCategory.handler(d), SAVE)
export const deleteCategory = async (input: unknown) =>
  write(idInput, input, (d) => actions.deleteCategory.handler(d), "The category wasn't deleted. Try again.")

export const createRecurring = async (input: unknown) =>
  write(createRecurringInput, input, (d) => actions.createRecurring.handler(d), SAVE)
export const updateRecurring = async (input: unknown) =>
  write(updateRecurringInput, input, (d) => actions.updateRecurring.handler(d), SAVE)
export const setRecurringActive = async (input: unknown) =>
  write(setActiveInput, input, (d) => actions.setRecurringActive.handler(d), SAVE)
export const deleteRecurring = async (input: unknown) =>
  write(idInput, input, (d) => actions.deleteRecurring.handler(d), "The template wasn't deleted. Try again.")
export const generateDue = async () =>
  write(z.object({}), {}, () => actions.generateDue.handler({}), "Nothing was generated. Try again.")

export const createGoal = async (input: unknown) => write(createGoalInput, input, (d) => actions.createGoal.handler(d), SAVE)
export const updateGoal = async (input: unknown) => write(updateGoalInput, input, (d) => actions.updateGoal.handler(d), SAVE)
export const deleteGoal = async (input: unknown) =>
  write(idInput, input, (d) => actions.deleteGoal.handler(d), "The goal wasn't deleted. Try again.")

export const savePlan = async (input: unknown) => write(planInput, input, (d) => actions.savePlan.handler(d), SAVE)

export const existingKeys = async (input: unknown) =>
  run(existingKeysInput, input, (d) => actions.existingKeys.handler(d), "Couldn't check for duplicates.")
export const importTransactions = async (input: unknown) =>
  write(importInput, input, (d) => actions.importTransactions.handler(d), "The import didn't go through. Nothing was saved.")
