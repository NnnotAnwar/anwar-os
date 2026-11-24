import "server-only"
import { parseInput } from "@/core/internal-api"
import { budgetBotRoute } from "./api"
import {
  create,
  createInput,
  deleteExpense,
  getExpense,
  heartbeat,
  heartbeatInput,
  idQuery,
  quickAdd,
  quickInput,
  range,
  rangeInput,
  recent,
  recentInput,
  setup,
  updateExpense,
  updateInput,
} from "./service"

// Handlers for /api/internal/budget-bot/*; the files under
// src/app/api/internal/budget-bot/ re-export them. Every one is HMAC-checked
// and runs as the site owner (api.ts). Amounts are positive minor units spent.

const query = (url: URL) => Object.fromEntries(url.searchParams)

/** GET setup: owner's timezone and today, accounts + the default one, expense categories (frequent first). */
export const setupGET = budgetBotRoute(async ({ owner }) => setup(owner.timezone))

/** POST expenses/quick { text, requireCategory?, accountId? }: parse one line and save it, or return the draft. */
export const quickPOST = budgetBotRoute(async ({ body, owner }) => quickAdd(parseInput(quickInput, body), owner.timezone))

/** POST expenses { amountMinor, categoryId?, note?, occurredOn?, accountId? }: save one expense. */
export const createPOST = budgetBotRoute(async ({ body, owner }) => create(parseInput(createInput, body), owner.timezone))

/** GET expenses/recent?limit=8&offset=0: newest first, with the total count. */
export const recentGET = budgetBotRoute(async ({ url }) => recent(parseInput(recentInput, query(url))))

/** GET expenses/range?from=YYYY-MM-DD&to=YYYY-MM-DD: every expense on those days (inclusive), oldest first. */
export const rangeGET = budgetBotRoute(async ({ url }) => range(parseInput(rangeInput, query(url))))

/** GET expense?id=<uuid>: one expense (404 gone when deleted or not an expense). */
export const expenseGET = budgetBotRoute(async ({ url, owner }) => getExpense(parseInput(idQuery, query(url)).id, owner.timezone))

/** POST expense/update { id, amountMinor?, categoryId?, note?, occurredOn? } */
export const updatePOST = budgetBotRoute(async ({ body, owner }) => updateExpense(parseInput(updateInput, body), owner.timezone))

/** POST expense/delete { id }: returns the deleted expense. */
export const deletePOST = budgetBotRoute(async ({ body, owner }) => deleteExpense(parseInput(idQuery, body).id, owner.timezone))

/** POST heartbeat { version, startedAt } */
export const heartbeatPOST = budgetBotRoute(async ({ body }) => {
  await heartbeat(parseInput(heartbeatInput, body))
  return { ok: true }
})
