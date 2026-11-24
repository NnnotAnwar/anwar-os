import { z } from "zod"
import { decodeImage, ImageDataError, type ImageMediaType } from "@/lib/image-data"

// Pure parts of "receipt photo → Budget": the image checks, the shape Claude
// fills in (structured output), and turning that into a draft expense. No
// server-only imports, so they are unit-tested directly (lib.test.ts).
// The photo itself is never stored: it lives in memory for one API call.

export type { ImageMediaType as ReceiptMediaType } from "@/lib/image-data"

/** A problem the owner can act on ("Try a sharper photo"); shown as is. */
export class ReceiptError extends Error {
  constructor(
    message: string,
    readonly code: "bad_image" | "unreadable" | "rate_limited" = "unreadable",
  ) {
    super(message)
  }
}

export type ReceiptImage = { data: string; mediaType: ImageMediaType }

/** base64 (optionally a data: URL) → a checked image for the API. */
export function decodeReceiptImage(input: string): ReceiptImage {
  try {
    const { data, mediaType } = decodeImage(input)
    return { data, mediaType }
  } catch (error) {
    if (error instanceof ImageDataError) throw new ReceiptError(error.message, "bad_image")
    throw error
  }
}

// ---------------------------------------------------------------------------
// What Claude returns (structured output; every field present, null = unknown)
// ---------------------------------------------------------------------------

export const receiptOutput = z.object({
  is_receipt: z.boolean().describe("True if the image shows a receipt, bill or invoice with a total."),
  total: z.number().nullable().describe("The grand total actually paid, in major units with a decimal point (312.5 for 312,50). Null if unreadable."),
  currency: z.string().nullable().describe("ISO 4217 code such as CZK or EUR. Null if not shown and not inferable."),
  merchant: z.string().nullable().describe("The shop or business name as a person would say it, e.g. Albert, Lidl, Bageterie Boulevard."),
  date: z.string().nullable().describe("The purchase date as YYYY-MM-DD. Null if not printed."),
  category: z.string().nullable().describe("Exactly one of the category names given, or null if none fits."),
  summary: z.string().nullable().describe("Two to six words on what was bought, in the receipt's language, e.g. 'groceries' or 'coffee and croissant'."),
})
export type ReceiptOutput = z.infer<typeof receiptOutput>

export const RECEIPT_SYSTEM = [
  "You read photos of shopping receipts for a personal budget app.",
  "Return the grand total that was paid (after discounts, including VAT), not a subtotal, a VAT line or the cash handed over.",
  "Czech receipts write 312,50 Kč: that is 312.5 CZK. A total ending in ,- is whole crowns.",
  "Pick the category from the given list only; null if none fits.",
  "If the image is not a receipt, set is_receipt to false and the other fields to null.",
].join("\n")

// ---------------------------------------------------------------------------
// Raw output → a draft expense
// ---------------------------------------------------------------------------

/** Currencies without minor units in ISO 4217 (Budget stores minor units). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "PYG"])

const CURRENCY_ALIASES: Record<string, string> = {
  KČ: "CZK",
  KC: "CZK",
  "€": "EUR",
  "£": "GBP",
  $: "USD",
  ZŁ: "PLN",
  ZL: "PLN",
  FT: "HUF",
}

export function normalizeCurrency(value: string | null | undefined, fallback: string): string {
  const v = value?.trim().toUpperCase()
  if (!v) return fallback
  if (CURRENCY_ALIASES[v]) return CURRENCY_ALIASES[v]
  return /^[A-Z]{3}$/.test(v) ? v : fallback
}

export function toMinorUnits(total: number, currency: string): number {
  return Math.round(total * (ZERO_DECIMAL.has(currency) ? 1 : 100))
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export type ReceiptContext = {
  /** Today in the owner's timezone, YYYY-MM-DD. */
  today: string
  /** The default account's currency, used when the receipt shows none. */
  defaultCurrency: string
  /** Expense categories the draft may be filed under. */
  categories: { id: string; name: string }[]
}

export type ReceiptFields = {
  /** Spent, positive minor units. */
  amountMinor: number
  currency: string
  merchant: string | null
  summary: string | null
  occurredOn: string
  /** True when the receipt had no usable date and today was assumed. */
  dateAssumed: boolean
  categoryId: string | null
  categoryName: string | null
}

export type NormalizedReceipt = { ok: true; fields: ReceiptFields } | { ok: false; reason: "not_receipt" | "no_total"; message: string }

const clean = (s: string | null | undefined, max: number) => {
  const v = s?.replace(/\s+/g, " ").trim()
  return v ? v.slice(0, max) : null
}

/**
 * Checks and tidies what Claude read: a positive total, an ISO currency, a
 * plausible date (not in the future, not over a year old: otherwise today), and
 * the category matched to one of the owner's by name.
 */
export function normalizeReceipt(raw: ReceiptOutput, ctx: ReceiptContext): NormalizedReceipt {
  if (!raw.is_receipt) return { ok: false, reason: "not_receipt", message: "That doesn't look like a receipt." }
  const currency = normalizeCurrency(raw.currency, ctx.defaultCurrency)
  const total = typeof raw.total === "number" && Number.isFinite(raw.total) ? Math.abs(raw.total) : 0
  const amountMinor = toMinorUnits(total, currency)
  if (amountMinor <= 0 || amountMinor > 1e11) {
    return { ok: false, reason: "no_total", message: "I couldn't find the total on that receipt. Try a sharper photo of the bottom part." }
  }

  const date = raw.date?.trim() ?? ""
  const plausible = isIsoDate(date) && date <= ctx.today && date >= addDays(ctx.today, -366)
  const wanted = raw.category?.trim().toLowerCase()
  const category = wanted ? ctx.categories.find((c) => c.name.toLowerCase() === wanted) : undefined

  return {
    ok: true,
    fields: {
      amountMinor,
      currency,
      merchant: clean(raw.merchant, 80),
      summary: clean(raw.summary, 80),
      occurredOn: plausible ? date : ctx.today,
      dateAssumed: !plausible,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
    },
  }
}

/** The account a receipt goes to: one in its currency (the default one first), else the default. */
export function pickAccount<A extends { id: string; currency: string }>(
  accounts: A[],
  defaultId: string | null,
  currency: string,
): { account: A | null; currencyMismatch: boolean } {
  const fallback = accounts.find((a) => a.id === defaultId) ?? accounts[0] ?? null
  if (fallback?.currency === currency) return { account: fallback, currencyMismatch: false }
  const same = accounts.find((a) => a.currency === currency)
  if (same) return { account: same, currencyMismatch: false }
  return { account: fallback, currencyMismatch: fallback !== null }
}

/** The note saved with the expense: the merchant, else what was bought. */
export function receiptNote(fields: Pick<ReceiptFields, "merchant" | "summary">): string {
  return (fields.merchant ?? fields.summary ?? "").slice(0, 200)
}
