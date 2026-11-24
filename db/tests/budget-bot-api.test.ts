// The expense bot's internal API (/api/internal/budget-bot/*) end to end:
// signature checks (its own secret and headers), acting as the site owner, every
// endpoint against the real Budget tables, RLS (the bot can only ever touch the
// owner's budget).
// `pnpm test:db`. `admin` sets up fixtures, `app` connects as os_app; the route
// handlers use the app's own pool (DATABASE_URL, os_app).
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/lib/signed-request"
import { BUDGET_BOT_SIGNATURE_HEADERS } from "@/modules/budget/bot-api/lib"
import { signedHeaders as osbotHeaders } from "@/modules/osbot/signature"

// The handlers start with `await connection()` so the build never prerenders
// them; outside Next there is no request scope for it, so it is stubbed here.
const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

const SECRET = `budget-bot-test-${randomBytes(24).toString("hex")}`
process.env.BOT_EXPENSES_API_SECRET = SECRET
const OSBOT_SECRET = `osbot-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = OSBOT_SECRET

const routes = await import("@/modules/budget/bot-api/routes")
const { budgetBotStatus } = await import("@/modules/budget/bot-api/service")
const { actAs, loadViewer } = await import("@/core/auth")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-budget-bot-bob-${run}`
const marker = `bb-${run}`
let owner = ""
let createdOwner = false
let previousBeat: { version: string; started_at: Date; last_beat_at: Date } | null = null
let bobAccount = ""
let bobTransaction = ""

type Handler = (request: Request) => Promise<Response>
const BASE = "http://127.0.0.1:3303"

function request(method: "GET" | "POST", path: string, body?: unknown, headers?: Record<string, string>) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const signed = headers ?? signedHeaders(SECRET, { method, path, body: raw }, BUDGET_BOT_SIGNATURE_HEADERS)
  return new Request(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...signed },
    body: method === "POST" ? raw : undefined,
  })
}

async function call(handler: Handler, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await handler(request(method, path, body))
  // Loose on purpose: each test asserts the shape it cares about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

const P = "/api/internal/budget-bot"
const get = (handler: Handler, path: string) => call(handler, "GET", `${P}${path}`)
const post = (handler: Handler, path: string, body: unknown) => call(handler, "POST", `${P}${path}`, body)

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-budget-bot-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  const [beat] = await admin`select version, started_at, last_beat_at from budget_bot_heartbeats where owner_id = ${owner}`
  previousBeat = (beat as typeof previousBeat) ?? null

  // Bob has his own budget with one expense the bot must never see or touch.
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  const [acc] = await admin`
    insert into budget_accounts (owner_id, name, currency) values (${bob}, 'Bob bank', 'CZK') returning id`
  bobAccount = acc!.id
  const [tr] = await admin`
    insert into budget_transactions (owner_id, account_id, amount_minor, occurred_on, note)
    values (${bob}, ${bobAccount}, -77700, current_date, ${`bob ${marker}`}) returning id`
  bobTransaction = tr!.id
})

afterAll(async () => {
  await admin`delete from budget_transactions where owner_id = ${owner} and note like ${`%${marker}%`}`
  await admin`delete from budget_categories where owner_id = ${owner} and name like ${`%${marker}%`}`
  await admin`delete from budget_transactions where owner_id = ${bob}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) {
    await admin`delete from budget_transactions where owner_id = ${owner}`
    await admin`delete from auth."user" where id = ${owner}`
  } else if (previousBeat) {
    await admin`
      update budget_bot_heartbeats set version = ${previousBeat.version}, started_at = ${previousBeat.started_at},
             last_beat_at = ${previousBeat.last_beat_at} where owner_id = ${owner}`
  } else {
    await admin`delete from budget_bot_heartbeats where owner_id = ${owner}`
  }
  await Promise.all([admin.end(), app.end()])
})

// ---------------------------------------------------------------------------

describe("budget-bot API: signatures", () => {
  const path = `${P}/setup`

  it("accepts a request signed with its own secret and headers", async () => {
    expect((await call(routes.setupGET, "GET", path)).status).toBe(200)
  })

  it("refuses unsigned, tampered, stale, replayed and osbot-signed requests", async () => {
    expect((await routes.setupGET(new Request(`${BASE}${path}`))).status).toBe(401)

    const sign = (over: Partial<{ path: string; secret: string; timestamp: string }> = {}) =>
      signedHeaders(over.secret ?? SECRET, { method: "GET", path: over.path ?? path, body: "", timestamp: over.timestamp }, BUDGET_BOT_SIGNATURE_HEADERS)
    expect((await routes.setupGET(request("GET", path, undefined, sign({ path: `${P}/expenses/recent` })))).status).toBe(401)
    expect((await routes.setupGET(request("GET", path, undefined, sign({ secret: `${SECRET}x` })))).status).toBe(401)
    const stale = String(Math.floor(Date.now() / 1000) - 120)
    expect((await routes.setupGET(request("GET", path, undefined, sign({ timestamp: stale })))).status).toBe(401)

    const once = sign()
    expect((await routes.setupGET(request("GET", path, undefined, once))).status).toBe(200)
    expect((await routes.setupGET(request("GET", path, undefined, once))).status).toBe(401)

    // osbot's secret and headers open osbot's API only.
    expect((await routes.setupGET(request("GET", path, undefined, osbotHeaders(OSBOT_SECRET, { method: "GET", path, body: "" })))).status).toBe(401)
    expect((await routes.setupGET(request("GET", path, undefined, osbotHeaders(SECRET, { method: "GET", path, body: "" })))).status).toBe(401)
  })

  it("refuses a body that differs from the signed one", async () => {
    const p = `${P}/expenses/quick`
    const headers = signedHeaders(SECRET, { method: "POST", path: p, body: JSON.stringify({ text: "1 food" }) }, BUDGET_BOT_SIGNATURE_HEADERS)
    const req = new Request(`${BASE}${p}`, { method: "POST", headers, body: JSON.stringify({ text: `999 food evil ${marker}` }) })
    expect((await routes.quickPOST(req)).status).toBe(401)
    expect(await admin`select 1 from budget_transactions where note like ${`%evil ${marker}%`}`).toHaveLength(0)
  })

  it("is switched off without BOT_EXPENSES_API_SECRET, even with osbot's set", async () => {
    delete process.env.BOT_EXPENSES_API_SECRET
    try {
      connection.mockClear()
      expect((await call(routes.setupGET, "GET", path)).status).toBe(404)
      // Opted out of prerendering before the early return, or the build bakes it in.
      expect(connection).toHaveBeenCalledOnce()
    } finally {
      process.env.BOT_EXPENSES_API_SECRET = SECRET
    }
  })
})

// ---------------------------------------------------------------------------

let food = ""
let health = ""

describe("budget-bot API: setup", () => {
  it("returns the owner's timezone, the default account and expense categories only", async () => {
    const { status, json } = await get(routes.setupGET, "/setup")
    expect(status).toBe(200)
    expect(json.timezone).toBeTruthy()
    expect(json.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(json.defaultAccountId).toBeTruthy()
    expect(json.accounts.map((a: { id: string }) => a.id)).toContain(json.defaultAccountId)
    expect(json.currency).toMatch(/^[A-Z]{3}$/)
    const names = json.categories.map((c: { name: string }) => c.name)
    expect(names).toEqual(expect.arrayContaining(["Food", "Health", "Other"]))
    expect(names).not.toContain("Salary")
    food = json.categories.find((c: { name: string }) => c.name === "Food").id
    health = json.categories.find((c: { name: string }) => c.name === "Health").id
    // Nothing of Bob's.
    expect(json.accounts.map((a: { id: string }) => a.id)).not.toContain(bobAccount)
  })
})

// ---------------------------------------------------------------------------

describe("budget-bot API: quick add", () => {
  it("saves '250 food lunch' as a Food expense for the site owner, with running totals", async () => {
    const { status, json } = await post(routes.quickPOST, "/expenses/quick", { text: `250 food lunch ${marker}` })
    expect(status).toBe(200)
    expect(json.status).toBe("created")
    expect(json.matchedBy).toBe("name")
    expect(json.expense).toMatchObject({ amountMinor: 25000, categoryId: food, categoryName: "Food", note: `lunch ${marker}` })
    expect(json.totals.day.CZK).toBeGreaterThanOrEqual(25000)
    expect(json.totals.monthTotals.CZK).toBeGreaterThanOrEqual(json.totals.day.CZK)
    const [row] = await admin`select owner_id, amount_minor::int, transfer_id from budget_transactions where id = ${json.expense.id}`
    expect(row).toMatchObject({ owner_id: owner, amount_minor: -25000, transfer_id: null })
  })

  it("returns a draft instead of saving when no category is clear", async () => {
    const note = `mystery ${marker}`
    const { status, json } = await post(routes.quickPOST, "/expenses/quick", { text: `89,90 ${note}` })
    expect(status).toBe(200)
    expect(json).toMatchObject({ status: "needs_category", draft: { amountMinor: 8990, note } })
    expect(await admin`select 1 from budget_transactions where note = ${note}`).toHaveLength(0)
  })

  it("files a note under the category it got before", async () => {
    const note = `pills ${marker}`
    await post(routes.createPOST, "/expenses", { amountMinor: 1000, categoryId: health, note })
    const { json } = await post(routes.quickPOST, "/expenses/quick", { text: `120 ${note.toUpperCase()}` })
    expect(json).toMatchObject({ status: "created", matchedBy: "note", expense: { categoryId: health, amountMinor: 12000 } })
  })

  it("refuses income and nonsense with a message the bot can show", async () => {
    const income = await post(routes.quickPOST, "/expenses/quick", { text: `+500 ${marker}` })
    expect(income.status).toBe(422)
    expect(income.json).toMatchObject({ error: "not_expense" })
    const nonsense = await post(routes.quickPOST, "/expenses/quick", { text: "hello" })
    expect(nonsense.status).toBe(400)
    expect(nonsense.json.message).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------

describe("budget-bot API: one expense", () => {
  let id = ""

  it("creates, reads, edits and deletes through the Budget module", async () => {
    const created = await post(routes.createPOST, "/expenses", { amountMinor: 4550, categoryId: food, note: `bread ${marker}` })
    expect(created.status).toBe(200)
    id = created.json.expense.id
    expect(created.json.expense).toMatchObject({ amountMinor: 4550, currency: "CZK", categoryName: "Food" })

    const got = await get(routes.expenseGET, `/expense?id=${id}`)
    expect(got.json.expense.id).toBe(id)

    const amount = await post(routes.updatePOST, "/expense/update", { id, amountMinor: 5000 })
    expect(amount.json.expense).toMatchObject({ amountMinor: 5000, categoryId: food, note: `bread ${marker}` })
    const moved = await post(routes.updatePOST, "/expense/update", { id, categoryId: health, note: "" })
    expect(moved.json.expense).toMatchObject({ amountMinor: 5000, categoryId: health, note: "" })
    const [row] = await admin`select amount_minor::int, note from budget_transactions where id = ${id}`
    expect(row).toEqual({ amount_minor: -5000, note: "" })

    const deleted = await post(routes.deletePOST, "/expense/delete", { id })
    expect(deleted.json.expense).toMatchObject({ id, amountMinor: 5000 })
    expect(await admin`select 1 from budget_transactions where id = ${id}`).toHaveLength(0)

    const gone = await get(routes.expenseGET, `/expense?id=${id}`)
    expect(gone).toMatchObject({ status: 404, json: { error: "gone" } })
    expect((await post(routes.deletePOST, "/expense/delete", { id })).status).toBe(404)
  })

  it("only takes spending categories", async () => {
    const [salary] = await admin`select id from budget_categories where owner_id = ${owner} and kind = 'income' limit 1`
    const refused = await post(routes.createPOST, "/expenses", { amountMinor: 100, categoryId: salary!.id, note: marker })
    expect(refused).toMatchObject({ status: 422, json: { error: "no_category" } })
    const bad = await post(routes.createPOST, "/expenses", { amountMinor: -100, note: marker })
    expect(bad.status).toBe(400)
  })

  it("can't see, change or delete anyone else's transactions (RLS)", async () => {
    expect((await get(routes.expenseGET, `/expense?id=${bobTransaction}`)).status).toBe(404)
    expect((await post(routes.updatePOST, "/expense/update", { id: bobTransaction, amountMinor: 1 })).status).toBe(404)
    expect((await post(routes.deletePOST, "/expense/delete", { id: bobTransaction })).status).toBe(404)
    const [row] = await admin`select owner_id, amount_minor::int from budget_transactions where id = ${bobTransaction}`
    expect(row).toEqual({ owner_id: bob, amount_minor: -77700 })
    // And Bob's own session never sees what the bot saved for the owner.
    const seen = await app.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${bob}, true)`
      return sql`select 1 from budget_transactions where note like ${`%${marker}%`} and owner_id <> ${bob}`
    })
    expect(seen).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe("budget-bot API: lists", () => {
  it("pages recent expenses newest first with a total", async () => {
    const first = await get(routes.recentGET, "/expenses/recent?limit=2&offset=0")
    expect(first.status).toBe(200)
    expect(first.json.items).toHaveLength(2)
    expect(first.json.total).toBeGreaterThanOrEqual(3)
    const second = await get(routes.recentGET, "/expenses/recent?limit=2&offset=2")
    expect(second.json.items[0].id).not.toBe(first.json.items[0].id)
    expect(first.json.items.every((x: { amountMinor: number }) => x.amountMinor > 0)).toBe(true)
  })

  it("lists a date range oldest first, spending only", async () => {
    const { json: setup } = await get(routes.setupGET, "/setup")
    const { status, json } = await get(routes.rangeGET, `/expenses/range?from=${setup.today}&to=${setup.today}`)
    expect(status).toBe(200)
    const notes = json.items.map((x: { note: string }) => x.note)
    expect(notes).toContain(`lunch ${marker}`)
    expect(json.items.every((x: { occurredOn: string }) => x.occurredOn === setup.today)).toBe(true)
    expect(notes).not.toContain(`bob ${marker}`)
    const backwards = await get(routes.rangeGET, `/expenses/range?from=2026-11-02&to=2026-11-01`)
    expect(backwards.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------

describe("budget-bot API: heartbeat", () => {
  it("records the bot's heartbeat for the Bots panel", async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString()
    expect((await post(routes.heartbeatPOST, "/heartbeat", { version: marker, startedAt })).status).toBe(200)
    const viewer = (await loadViewer(owner))!
    const status = await actAs(viewer, () => budgetBotStatus())
    expect(status).toMatchObject({ configured: true, connected: true, version: marker, startedAt })
  })

  it("the registry accepts budget-bot as a stats source", async () => {
    const [row] = await admin`
      insert into bots_bots (owner_id, name, stats_source) values (${bob}, ${`Expenses ${run}`}, 'budget-bot') returning stats_source`
    expect(row!.stats_source).toBe("budget-bot")
  })
})
