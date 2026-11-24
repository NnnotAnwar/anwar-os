// Searching transactions by amount: "250", "-250", "250,50", "1 250 Kč". Pure.
import { parseAmount } from "./money"

export type AmountQuery = {
  /** Inclusive range of absolute amounts, in minor units. */
  min: number
  max: number
  /** Only spending ("-"), only income ("+"), or either. */
  sign: "+" | "-" | null
}

/**
 * Reads a search query as an amount. A whole number covers its cents too
 * ("250" → 250.00–250.99, the way people remember a price); typed decimals
 * match exactly ("250,50"). Null when the query isn't one clear amount.
 */
export function amountQuery(text: string): AmountQuery | null {
  const parsed = parseAmount(text)
  if (!parsed || parsed.minor <= 0) return null
  const typedCents = /[.,]\d{1,2}(?!\d)/.test(text)
  const whole = !typedCents && parsed.minor % 100 === 0
  return { min: parsed.minor, max: whole ? parsed.minor + 99 : parsed.minor, sign: parsed.sign }
}
