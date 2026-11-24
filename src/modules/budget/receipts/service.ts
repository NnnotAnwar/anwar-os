import "server-only"
import { recordUsage } from "@/core/ai-usage"
import { requireViewer } from "@/core/auth"
import { db } from "@/db"
import { claudeClient, claudeConfig, ClaudeDisabledError } from "@/lib/claude"
import { consumeRateLimit } from "@/lib/rate-limit"
import { actions } from "../actions"
import { todayIn } from "../lib/dates"
import { defaultAccountId } from "../lib/quick-add"
import { extractReceipt } from "./extract"
import { decodeReceiptImage, normalizeReceipt, pickAccount, receiptNote, ReceiptError, type ReceiptFields } from "./lib"

// "Receipt photo → Budget", the one server-side function behind both doors:
// the Budget quick add in the app (server-actions.ts) and the expense bot
// (POST /api/internal/budget-bot/receipt, which runs as the site owner). The
// bot never holds the API key; the photo is read once and dropped.

/** Receipt photos per user per hour (each is one Claude call). */
const RATE = { window: 60 * 60, max: 60 }

export type ReceiptDraft = ReceiptFields & {
  /** What to save as the expense's note (the merchant, else what was bought). */
  note: string
  accountId: string | null
  accountName: string | null
  accountCurrency: string | null
  /** The receipt's currency has no account: saving would book it in the account's currency. */
  currencyMismatch: boolean
}

export type ScanResult = { status: "ok"; draft: ReceiptDraft } | { status: "not_receipt" | "no_total"; message: string }

/** Reads a receipt photo (base64 or a data: URL) into a draft expense. Saves nothing. */
export async function scanReceipt(imageBase64: string): Promise<ScanResult> {
  const config = claudeConfig()
  if (!config.apiKey) throw new ClaudeDisabledError()
  const image = decodeReceiptImage(imageBase64)
  const viewer = await requireViewer()

  const limit = await consumeRateLimit(db, `ai-receipt:${viewer.id}`, RATE)
  if (!limit.allowed) throw new ReceiptError("That's a lot of receipts for one hour. Try again a bit later.", "rate_limited")

  await actions.ensureSetup.handler({})
  const [accounts, categories] = await Promise.all([
    actions.listAccounts.handler({ includeArchived: false }),
    actions.listCategories.handler({ includeArchived: false }),
  ])
  const expense = categories.filter((c) => c.kind === "expense")
  const defaultId = defaultAccountId(accounts)
  const defaultCurrency = accounts.find((a) => a.id === defaultId)?.currency ?? "CZK"
  const today = todayIn(viewer.timezone)

  const extracted = await extractReceipt(claudeClient(), config.receiptModel, image, {
    today,
    timezone: viewer.timezone,
    defaultCurrency,
    categoryNames: expense.map((c) => c.name),
  })
  await recordUsage({ kind: "receipt", model: extracted.model, usage: extracted.usage })

  const normalized = normalizeReceipt(extracted.output, { today, defaultCurrency, categories: expense })
  if (!normalized.ok) return { status: normalized.reason, message: normalized.message }
  const fields = normalized.fields
  const { account, currencyMismatch } = pickAccount(accounts, defaultId, fields.currency)
  return {
    status: "ok",
    draft: {
      ...fields,
      note: receiptNote(fields),
      accountId: account?.id ?? null,
      accountName: account?.name ?? null,
      accountCurrency: account?.currency ?? null,
      currencyMismatch,
    },
  }
}
