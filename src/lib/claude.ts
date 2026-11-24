import "server-only"
import Anthropic from "@anthropic-ai/sdk"

// The app's one door to the Claude API: the AI assistant (src/modules/assistant)
// and receipt photos (src/modules/budget/receipts) call Claude from the server
// only. The key never reaches a browser or a bot; CSP is unaffected.
//
// Environment (web only; infra/.env.example):
//   ANTHROPIC_API_KEY          required to switch AI on; unset = the assistant shows
//                              "Add ANTHROPIC_API_KEY on the server", receipts refuse
//   ASSISTANT_MODEL            chat model, default claude-sonnet-5-5
//   ASSISTANT_EFFORT           low | medium | high, default low (chat is latency-bound)
//   ASSISTANT_MAX_TOKENS       per response, default 8192
//   ASSISTANT_MONTHLY_LIMIT_USD  optional: refuse new chat turns once the estimated
//                              spend this month (chat + receipts) reaches it
//   RECEIPT_MODEL              receipt photos, default claude-haiku-5-5
// The SDK also honours ANTHROPIC_BASE_URL (unused in production).

export type Effort = "low" | "medium" | "high"

export type ClaudeConfig = {
  apiKey: string | null
  chatModel: string
  chatEffort: Effort
  maxTokens: number
  monthlyLimitUsd: number | null
  receiptModel: string
}

const MODEL_ID = /^[a-z0-9][a-z0-9.\-_:@/]{2,79}$/

function model(value: string | undefined, fallback: string) {
  const v = value?.trim()
  return v && MODEL_ID.test(v) ? v : fallback
}

export function claudeConfig(env: Record<string, string | undefined> = process.env): ClaudeConfig {
  const effort = env.ASSISTANT_EFFORT?.trim()
  const maxTokens = Number(env.ASSISTANT_MAX_TOKENS)
  const limit = Number(env.ASSISTANT_MONTHLY_LIMIT_USD)
  return {
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    chatModel: model(env.ASSISTANT_MODEL, "claude-sonnet-5-5"),
    chatEffort: effort === "medium" || effort === "high" ? effort : "low",
    maxTokens: Number.isInteger(maxTokens) && maxTokens >= 1024 && maxTokens <= 64_000 ? maxTokens : 8192,
    monthlyLimitUsd: Number.isFinite(limit) && limit > 0 ? limit : null,
    receiptModel: model(env.RECEIPT_MODEL, "claude-haiku-5-5"),
  }
}

/** AI features are on only when the server has an API key. */
export function isClaudeEnabled(): boolean {
  return claudeConfig().apiKey !== null
}

/** Thrown when AI is used without a key; callers turn it into "Add ANTHROPIC_API_KEY on the server". */
export class ClaudeDisabledError extends Error {
  constructor() {
    super("AI is off: add ANTHROPIC_API_KEY on the server.")
  }
}

let cached: { key: string; client: Anthropic } | null = null
let override: Anthropic | null = null

/** The shared client (2 retries on 429/5xx, the SDK default). */
export function claudeClient(): Anthropic {
  if (override) return override
  const { apiKey } = claudeConfig()
  if (!apiKey) throw new ClaudeDisabledError()
  if (cached?.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, timeout: 120_000 }) }
  return cached.client
}

/** Tests only: answer with a scripted stand-in instead of the real API. */
export function setClaudeClientForTests(client: unknown) {
  override = client as Anthropic | null
}

/** A failure from the API as one sentence the owner can act on. */
export function describeClaudeError(error: unknown): string {
  if (error instanceof ClaudeDisabledError) return error.message
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return "The Anthropic API refused the key. Check ANTHROPIC_API_KEY on the server."
  }
  if (error instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now. Try again in a minute."
  if (error instanceof Anthropic.BadRequestError) return "Claude couldn't take that request. Try rephrasing, or start a new chat."
  if (error instanceof Anthropic.InternalServerError) return "Claude is having trouble right now. Try again in a bit."
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Try again in a bit."
  if (error instanceof Anthropic.APIError) return `The Anthropic API answered ${error.status ?? "with an error"}. Try again in a bit.`
  return "Something went wrong talking to Claude. Try again."
}
