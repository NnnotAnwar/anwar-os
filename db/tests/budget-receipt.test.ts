// Receipt photo → Budget through the expense bot's API:
// POST /api/internal/budget-bot/receipt (src/modules/budget/receipts). Signed
// like the rest of the bot's API, runs as the site owner, reads the photo with
// a scripted stand-in for Claude (no network, no key) and saves nothing.
// `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/lib/signed-request"
import { BUDGET_BOT_SIGNATURE_HEADERS } from "@/modules/budget/bot-api/lib"

const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

const SECRET = `budget-receipt-test-${randomBytes(24).toString("hex")}`
process.env.BOT_EXPENSES_API_SECRET = SECRET

const { receiptPOST } = await import("@/modules/budget/receipts/bot-route")
const { setClaudeClientForTests } = await import("@/lib/claude")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const run = randomBytes(4).toString("hex")
let owner = ""
let createdOwner = false
let eurAccount = ""

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]).toString("base64")
const PATH = "/api/internal/budget-bot/receipt"

function post(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body)
  return receiptPOST(
    new Request(`http://127.0.0.1:3303${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...signedHeaders(secret, { method: "POST", path: PATH, body: raw }, BUDGET_BOT_SIGNATURE_HEADERS) },
      body: raw,
    }),
  )
}

async function call(body: unknown) {
  const response = await post(body)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

function claudeReads(output: Record<string, unknown> | null, stop_reason = "end_turn") {
  const parse = vi.fn(async () => ({ model: "claude-haiku-5-5", stop_reason, parsed_output: output, usage: { input_tokens: 1500, output_tokens: 60 } }))
  setClaudeClientForTests({ messages: { parse } })
  return parse
}

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-receipt-owner-${run}`
    createdOwner = true
    await admin`insert into auth."user" (id, name, email, email_verified, role) values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
})

afterAll(async () => {
  setClaudeClientForTests(null)
  delete process.env.ANTHROPIC_API_KEY
  if (eurAccount) await admin`delete from budget_accounts where id = ${eurAccount}`
  await admin`delete from assistant_usage where owner_id = ${owner} and kind = 'receipt' and model = 'claude-haiku-5-5' and input_tokens = 1500`
  await admin`delete from auth.rate_limit where key = ${`ai-receipt:${owner}`}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await admin.end()
})

describe("POST /api/internal/budget-bot/receipt", () => {
  it("is signed like the rest of the bot's API", async () => {
    const response = await post({ image: JPEG }, "wrong-secret-wrong-secret-wrong-secret")
    expect(response.status).toBe(401)
  })

  it("says AI is off without ANTHROPIC_API_KEY", async () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(await call({ image: JPEG })).toEqual({
      status: 503,
      json: { error: "ai_disabled", message: "Receipt reading is off: add ANTHROPIC_API_KEY on the server." },
    })
  })

  it("reads a receipt into a draft with the owner's category and default account, saving nothing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real"
    const [{ n: before }] = await admin`select count(*)::int as n from budget_transactions where owner_id = ${owner}`
    const parse = claudeReads({ is_receipt: true, total: 312.5, currency: "CZK", merchant: "Albert", date: null, category: "Food", summary: "groceries" })
    const { status, json } = await call({ image: JPEG })
    expect(status).toBe(200)
    expect(json.status).toBe("ok")
    const [food] = await admin`select id from budget_categories where owner_id = ${owner} and name = 'Food' and kind = 'expense'`
    expect(json.draft).toMatchObject({
      amountMinor: 31250,
      currency: "CZK",
      merchant: "Albert",
      note: "Albert",
      categoryId: food!.id,
      categoryName: "Food",
      dateAssumed: true,
      accountCurrency: "CZK",
      currencyMismatch: false,
    })
    expect(json.draft.accountId).toMatch(/^[0-9a-f-]{36}$/)
    // The photo went to Claude once; the owner's categories went with it.
    expect(parse).toHaveBeenCalledOnce()
    const params = (parse.mock.calls[0] as unknown as [{ messages: { content: { type: string; text?: string }[] }[] }])[0]
    expect(params.messages[0]!.content[1]!.text).toContain("Food")
    const [{ n: after }] = await admin`select count(*)::int as n from budget_transactions where owner_id = ${owner}`
    expect(after).toBe(before)
    const [usage] = await admin`select count(*)::int as n from assistant_usage where owner_id = ${owner} and kind = 'receipt' and input_tokens = 1500`
    expect(usage!.n).toBeGreaterThanOrEqual(1)
  })

  it("files a foreign-currency receipt under an account in that currency", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real"
    ;[{ id: eurAccount }] = await admin`
      insert into budget_accounts (owner_id, name, currency) values (${owner}, ${`Euro ${run}`}, 'EUR') returning id`
    claudeReads({ is_receipt: true, total: 4.2, currency: "EUR", merchant: "Café", date: "2026-11-20", category: null, summary: null })
    const { json } = await call({ image: JPEG })
    expect(json.draft).toMatchObject({ amountMinor: 420, currency: "EUR", accountId: eurAccount, currencyMismatch: false, categoryId: null })
  })

  it("explains non-receipts, unreadable answers and bad images", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real"
    claudeReads({ is_receipt: false, total: null, currency: null, merchant: null, date: null, category: null, summary: null })
    expect(await call({ image: JPEG })).toEqual({ status: 200, json: { status: "not_receipt", message: "That doesn't look like a receipt." } })
    claudeReads(null, "refusal")
    expect(await call({ image: JPEG })).toMatchObject({ status: 422, json: { error: "unreadable" } })
    claudeReads(null)
    expect(await call({ image: Buffer.from("%PDF-1.7 not an image at all").toString("base64") })).toMatchObject({
      status: 422,
      json: { error: "bad_image", message: "Send a JPEG, PNG, WebP or GIF photo." },
    })
    expect(await call({})).toMatchObject({ status: 400, json: { error: "invalid_input" } })
  })
})
