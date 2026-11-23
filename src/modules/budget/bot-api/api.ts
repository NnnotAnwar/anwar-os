import "server-only"
import { internalApi } from "@/core/internal-api"
import { BUDGET_BOT_SIGNATURE_HEADERS } from "./lib"

// The wrapper every /api/internal/budget-bot/* handler goes through: the shared
// internal API factory (src/core/internal-api.ts) with the expense bot's own
// secret and headers. Off (404) unless BOT_EXPENSES_API_SECRET is set; signed
// with x-budget-bot-* headers (bots/expenses/expenses_bot/signing.py); runs as
// the site owner, so RLS scopes everything to the owner's budget.

export const budgetBotRoute = internalApi({
  name: "budget-bot api",
  secretEnv: "BOT_EXPENSES_API_SECRET",
  headers: BUDGET_BOT_SIGNATURE_HEADERS,
  // An import batch (up to 500 rows) is bigger than osbot's messages.
  maxBodyBytes: 256 * 1024,
})
