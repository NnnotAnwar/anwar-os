import "server-only"
import { budgetBotRoute } from "@/modules/budget/bot-api/api"
import { OsbotApiError, osbotRoute, parseInput } from "@/modules/osbot/api"
import {
  ackErrorAlerts,
  ackErrorAlertsInput,
  botErrorInput,
  ErrorNotFound,
  errorStatusInput,
  recordBotError,
  setErrorStatus,
} from "./errors"

// The bots' side of the error log (src/modules/ops/errors.ts). Files under
// src/app/api/internal/{osbot,budget-bot}/… re-export these; each is signed
// with that bot's own secret and acts as the site owner.

/** POST /api/internal/osbot/errors/report { name, message, stack, where }: osbot's own unhandled exception. */
export const errorsReportPOST = osbotRoute(async ({ body }) => recordBotError("osbot", parseInput(botErrorInput, body)))

/** POST /api/internal/budget-bot/errors/report: the same for the expense bot. */
export const budgetBotErrorsReportPOST = budgetBotRoute(async ({ body }) => recordBotError("expense-bot", parseInput(botErrorInput, body)))

/** POST /api/internal/osbot/errors/status { id, status: "resolved" | "open" }: the alert's ✓ Resolve and its Undo. */
export const errorsStatusPOST = osbotRoute(async ({ body }) => {
  try {
    return await setErrorStatus(parseInput(errorStatusInput, body))
  } catch (error) {
    if (error instanceof ErrorNotFound) throw new OsbotApiError(404, "gone", error.message)
    throw error
  }
})

/** POST /api/internal/osbot/ops-alerts/errors/ack { ids }: after one error message (single or summary) was sent. */
export const errorAlertsAckPOST = osbotRoute(async ({ body }) => ackErrorAlerts(parseInput(ackErrorAlertsInput, body)))
