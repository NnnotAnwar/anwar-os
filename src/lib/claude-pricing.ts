// Cost estimates for the token log (assistant_usage) and the monthly line in
// Settings. List prices in US dollars per million tokens, first-party API,
// prompts up to 100K tokens. 5-minute cache writes cost 1.25x input. These are
// estimates for "am I spending pennies or dollars", not an invoice: the
// Anthropic Console is the source of truth.

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number }

const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
}

/** Unknown models are priced like Sonnet 5.5 (the default chat model). */
export function priceOf(model: string): ModelPrice {
  return PRICES[model] ?? PRICES["claude-sonnet-5-5"]!
}

export type TokenCounts = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** The SDK's usage object (input_tokens excludes cached tokens) as our counts. */
export function tokenCounts(usage: {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}): TokenCounts {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

/** Estimated cost in millionths of a dollar (integer). */
export function costMicroUsd(model: string, t: TokenCounts): number {
  const p = priceOf(model)
  // $ per MTok × tokens / 1e6 × 1e6 micro-dollars = price × tokens.
  const micro = p.input * t.inputTokens + p.output * t.outputTokens + p.cacheRead * t.cacheReadTokens + p.cacheWrite * t.cacheWriteTokens
  return Math.round(micro)
}

/** 1234567 micro-dollars → "$1.23"; under a cent → "<$0.01"; zero → "$0.00". */
export function formatUsd(micro: number): string {
  if (micro === 0) return "$0.00"
  const dollars = micro / 1e6
  if (dollars < 0.01) return "<$0.01"
  return `$${dollars.toFixed(2)}`
}

/** 0 → "0", 950 → "950", 12_300 → "12.3k", 1_250_000 → "1.25M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${trim((n / 1000).toFixed(1))}k`
  return `${trim((n / 1_000_000).toFixed(2))}M`
}

function trim(s: string) {
  return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")
}
