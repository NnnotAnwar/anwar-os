import "server-only"
import { z } from "zod"
import { internalApi, InternalApiError, parseInput } from "@/core/internal-api"
import { ClaudeDisabledError, describeClaudeError } from "@/lib/claude"
import { BUDGET_BOT_SIGNATURE_HEADERS } from "../bot-api/lib"
import { ReceiptError } from "./lib"
import { scanReceipt } from "./service"

// POST /api/internal/budget-bot/receipt { image: base64 } → { status: "ok", draft }
// or { status: "not_receipt" | "no_total", message }. Saves nothing: the bot
// shows the draft and saves with POST expenses on the owner's tap.
//
// Same secret, headers and owner as the rest of the expense bot's API
// (bot-api/api.ts); its own wrapper only for the larger body a photo needs.
// Errors: 503 ai_disabled (no ANTHROPIC_API_KEY), 422 bad_image / unreadable,
// 429 rate_limited, 502 ai_failed (the Anthropic API failed; details logged).

const budgetBotReceiptRoute = internalApi({
  name: "budget-bot api",
  secretEnv: "BOT_EXPENSES_API_SECRET",
  headers: BUDGET_BOT_SIGNATURE_HEADERS,
  // A Telegram photo is ~100-300 KB; base64 adds a third. Generous headroom.
  maxBodyBytes: 8 * 1024 * 1024,
})

const receiptInput = z.object({ image: z.string().min(16, "Send a photo.").max(8 * 1024 * 1024) })

export const receiptPOST = budgetBotReceiptRoute(async ({ body }) => {
  const { image } = parseInput(receiptInput, body)
  try {
    return await scanReceipt(image)
  } catch (error) {
    if (error instanceof ClaudeDisabledError) throw new InternalApiError(503, "ai_disabled", "Receipt reading is off: add ANTHROPIC_API_KEY on the server.")
    if (error instanceof ReceiptError) throw new InternalApiError(error.code === "rate_limited" ? 429 : 422, error.code, error.message)
    if (error instanceof InternalApiError) throw error
    console.error("budget-bot api: receipt failed", error)
    throw new InternalApiError(502, "ai_failed", describeClaudeError(error))
  }
})
