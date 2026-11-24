// Budget limits end to end: Budget's own actions (limits, setLimit,
// removeLimit), the shape rules on budget_limits (top-level expense categories
// only, the owner's own), RLS, the expense bot's "left" line and GET limits, and
// osbot's alerts (budget-limits/due + budget-limits/ack: once per category,
// month and threshold). `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders as budgetBotHeaders } from "@/lib/signed-request"
import { BUDGET_BOT_SIGNATURE_HEADERS } from "@/modules/budget/bot-api/lib"
import { signedHeaders } from "@/modules/osbot/signature"

const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

const SECRET = `osbot-limits-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
const BUDGET_SECRET = `budget-bot-limits-${randomBytes(24).toString("hex")}`
process.env.BOT_EXPENSES_API_SECRET = BUDGET_SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const alerts = await import("@/modules/osbot/limit-alerts")
const { limitsGET } = await import("@/modules/budget/bot-api/limits")
const { quickPOST, createPOST } = await import("@/modules/budget/bot-api/routes")
const { actAs, loadViewer } = await import("@/core/auth")
const { actions } = await import("@/modules/budget/actions")
const { monthOf, monthRange, shiftMonth, todayIn } = await import("@/modules/budget/lib/dates")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-limits-bob-${run}`
const marker = `lim${run}`
let owner = ""
let createdOwner = false
let account = ""
let eurAccount = ""
let today = ""
let month = ""
const cat: Record<string, string> = {}
let bobCategory = ""

function as<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function pgError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    return (e as { code?: string }).code
  }
  return null
}

async function asOwner<T>(fn: () => Promise<T>) {
  const viewer = await loadViewer(owner)
  return actAs(viewer!, fn)
}

type Handler = (request: Request) => Promise<Response>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

async function osbot(handler: Handler, method: "GET" | "POST", path: string, body?: unknown, sign = true) {
  const full = `/api/internal/osbot${path}`
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers = sign ? signedHeaders(SECRET, { method, path: full, body: raw }) : {}
  const response = await handler(
    new Request(`http://127.0.0.1:3303${full}`, { method, headers: { "content-type": "application/json", ...headers }, body: method === "POST" ? raw : undefined }),
  )
  return { status: response.status, json: (await response.json()) as Json }
}

async function bot(handler: Handler, method: "GET" | "POST", path: string, body?: unknown) {
  const full = `/api/internal/budget-bot${path}`
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers = budgetBotHeaders(BUDGET_SECRET, { method, path: full, body: raw }, BUDGET_BOT_SIGNATURE_HEADERS)
  const response = await handler(
    new Request(`http://127.0.0.1:3303${full}`, { method, headers: { "content-type": "application/json", ...headers }, body: method === "POST" ? raw : undefined }),
  )
  return { status: response.status, json: (await response.json()) as Json }
}

async function spend(categoryId: string | null, amount: number, day = today, acc = account) {
  await admin`
    insert into budget_transactions (owner_id, account_id, category_id, amount_minor, occurred_on, note)
    values (${owner}, ${acc}, ${categoryId}, ${-amount}, ${day}, ${`spent ${marker}`})`
}

const mine = <T extends { name: string }>(items: T[]) => items.filter((x) => x.name.includes(marker))

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-limits-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`insert into auth."user" (id, name, email, email_verified) values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  const viewer = await loadViewer(owner)
  today = todayIn(viewer!.timezone)
  month = monthOf(today)
  // Base currency CZK (the default) unless the owner already chose one.
  await asOwner(() => actions.ensureSetup.handler({}))
  const [settings] = await admin`select base_currency from budget_settings where owner_id = ${owner}`
  expect(settings!.base_currency).toBe("CZK")

  const [acc] = await admin`insert into budget_accounts (owner_id, name, currency) values (${owner}, ${`Bank ${marker}`}, 'CZK') returning id`
  account = acc!.id
  const [eur] = await admin`insert into budget_accounts (owner_id, name, currency) values (${owner}, ${`Euro ${marker}`}, 'EUR') returning id`
  eurAccount = eur!.id
  const category = async (name: string, kind = "expense", parent: string | null = null) => {
    const [c] = await admin`
      insert into budget_categories (owner_id, name, kind, parent_id) values (${owner}, ${`${name} ${marker}`}, ${kind}, ${parent}) returning id`
    return c!.id as string
  }
  cat.food = await category("Food")
  cat.groceries = await category("Groceries", "expense", cat.food)
  cat.fun = await category("Fun")
  cat.travel = await category("Travel")
  cat.salary = await category("Salary", "income")
  const [bc] = await admin`insert into budget_categories (owner_id, name, kind) values (${bob}, 'Bob food', 'expense') returning id`
  bobCategory = bc!.id

  // This month: Food 3 000 directly + 2 000 in Groceries = 5 000; Fun 950.
  await spend(cat.food, 300000)
  await spend(cat.groceries, 200000)
  await spend(cat.fun, 95000)
  // Not counted: another currency, and a transfer leg.
  await spend(cat.food, 999900, today, eurAccount)
  await admin`
    insert into budget_transactions (owner_id, account_id, category_id, amount_minor, occurred_on, note, transfer_id)
    values (${owner}, ${account}, ${cat.food}, -777700, ${today}, ${`transfer ${marker}`}, gen_random_uuid())`
  // The three months before: Food 4 500 + 6 000 + 7 500 → averages 6 000; Travel 9 000 once → 3 000.
  await spend(cat.food, 450000, monthRange(shiftMonth(month, -1)).from)
  await spend(cat.food, 600000, monthRange(shiftMonth(month, -2)).from)
  await spend(cat.groceries, 750000, monthRange(shiftMonth(month, -3)).from)
  await spend(cat.travel, 900000, monthRange(shiftMonth(month, -2)).to)
  // Four months back doesn't count.
  await spend(cat.travel, 5000000, monthRange(shiftMonth(month, -4)).from)
})

afterAll(async () => {
  await admin`delete from osbot_deliveries where owner_id in (${owner}, ${bob}) and kind = 'budget-limit'`
  await admin`delete from budget_limits where owner_id in (${owner}, ${bob})`
  await admin`delete from budget_transactions where account_id in (${account}, ${eurAccount})`
  await admin`delete from budget_categories where owner_id = ${owner} and name like ${`%${marker}`} and parent_id is not null`
  await admin`delete from budget_categories where owner_id = ${owner} and name like ${`%${marker}`}`
  await admin`delete from budget_accounts where id in (${account}, ${eurAccount})`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("budget: limits", () => {
  it("lists top-level expense categories without a limit, with their three-month averages", async () => {
    const data = await asOwner(() => actions.limits.handler({}))
    expect(data.month).toBe(month)
    expect(data.baseCurrency).toBe("CZK")
    expect(mine(data.items)).toEqual([])
    const without = Object.fromEntries(mine(data.withoutLimit).map((x) => [x.name.replace(` ${marker}`, ""), x.averageMinor]))
    // Subcategories roll up; income and subcategories themselves aren't listed.
    expect(without).toEqual({ Food: 600000, Fun: 0, Travel: 300000 })
  })

  it("sets limits only on top-level expense categories", async () => {
    await expect(asOwner(() => actions.setLimit.handler({ categoryId: cat.salary!, amountMinor: 100 }))).rejects.toThrow("expense categories")
    await expect(asOwner(() => actions.setLimit.handler({ categoryId: cat.groceries!, amountMinor: 100 }))).rejects.toThrow("parent category")
    await expect(asOwner(() => actions.setLimit.handler({ categoryId: bobCategory, amountMinor: 100 }))).rejects.toThrow("doesn't exist")
    await asOwner(() => actions.setLimit.handler({ categoryId: cat.food!, amountMinor: 500000 }))
    await asOwner(() => actions.setLimit.handler({ categoryId: cat.food!, amountMinor: 600000 }))
    await asOwner(() => actions.setLimit.handler({ categoryId: cat.fun!, amountMinor: 100000 }))
    const [count] = await admin`select count(*)::int as n from budget_limits where owner_id = ${owner} and category_id = ${cat.food}`
    expect(count!.n).toBe(1)
  })

  it("counts this month's spending with subcategories, in the base currency, fullest first", async () => {
    const data = await asOwner(() => actions.limits.handler({}))
    const items = mine(data.items)
    expect(items.map((x) => x.name.replace(` ${marker}`, ""))).toEqual(["Fun", "Food"])
    expect(items[0]).toMatchObject({ limitMinor: 100000, spentMinor: 95000, leftMinor: 5000, percent: 95, status: "near" })
    expect(items[1]).toMatchObject({ limitMinor: 600000, spentMinor: 500000, leftMinor: 100000, percent: 83, status: "ok", averageMinor: 600000 })
    expect(mine(data.withoutLimit).map((x) => x.name.replace(` ${marker}`, ""))).toEqual(["Travel"])
    // An earlier month: its own spending, no pace.
    const earlier = await asOwner(() => actions.limits.handler({ month: shiftMonth(month, -1) }))
    expect(mine(earlier.items).find((x) => x.categoryId === cat.food)).toMatchObject({ spentMinor: 450000, paceMinor: null })
  })

  it("refuses a limit on a subcategory or on another user's category at the database too", async () => {
    expect(await pgError(as(owner, (sql) => sql`insert into budget_limits (category_id, amount_minor) values (${cat.groceries!}, 100)`))).toBe("23514")
    expect(await pgError(as(owner, (sql) => sql`insert into budget_limits (category_id, amount_minor) values (${cat.salary!}, 100)`))).toBe("23514")
    // Bob's category: the composite foreign key (owner, category) fails for the owner…
    expect(await pgError(as(owner, (sql) => sql`insert into budget_limits (category_id, amount_minor) values (${bobCategory}, 100)`))).toBe("23503")
    // …Bob can't even see the owner's category to put a limit on it…
    expect(
      await pgError(as(bob, (sql) => sql`insert into budget_limits (owner_id, category_id, amount_minor) values (${owner}, ${cat.travel!}, 100)`)),
    ).toBe("23503")
    // …and can't write a row in the owner's name.
    expect(
      await pgError(as(bob, (sql) => sql`insert into budget_limits (owner_id, category_id, amount_minor) values (${owner}, ${bobCategory}, 100)`)),
    ).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`update budget_limits set amount_minor = 0 where category_id = ${cat.food!}`))).toBe("23514")
  })

  it("never shows or changes the owner's limits for another user", async () => {
    expect(await as(bob, (sql) => sql`select 1 from budget_limits where owner_id = ${owner}`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`update budget_limits set amount_minor = 1 where owner_id = ${owner} returning id`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`delete from budget_limits where owner_id = ${owner} returning id`)).toHaveLength(0)
    expect(await as(null, (sql) => sql`select 1 from budget_limits`)).toHaveLength(0)
  })

  it("drops a category's limit when it becomes a subcategory, and with the category", async () => {
    await asOwner(() => actions.setLimit.handler({ categoryId: cat.travel!, amountMinor: 300000 }))
    await asOwner(() =>
      actions.updateCategory.handler({ id: cat.travel!, name: `Travel ${marker}`, kind: "expense", parentId: cat.fun!, color: "sky" }),
    )
    const [moved] = await admin`select count(*)::int as n from budget_limits where category_id = ${cat.travel}`
    expect(moved!.n).toBe(0)
    await asOwner(() => actions.updateCategory.handler({ id: cat.travel!, name: `Travel ${marker}`, kind: "expense", parentId: null, color: "sky" }))
    const [extra] = await admin`insert into budget_categories (owner_id, name) values (${owner}, ${`Temp ${marker}`}) returning id`
    await asOwner(() => actions.setLimit.handler({ categoryId: extra!.id, amountMinor: 100 }))
    await asOwner(() => actions.deleteCategory.handler({ id: extra!.id }))
    const [gone] = await admin`select count(*)::int as n from budget_limits where category_id = ${extra!.id}`
    expect(gone!.n).toBe(0)
  })
})

describe("budget-bot API: limits", () => {
  it("adds the category's limit to a saved expense (the parent's for a subcategory)", async () => {
    const saved = await bot(createPOST, "POST", "/expenses", { amountMinor: 30000, categoryId: cat.groceries, note: `bread ${marker}` })
    expect(saved.status).toBe(200)
    expect(saved.json.limit).toMatchObject({ categoryId: cat.food, limitMinor: 600000, spentMinor: 530000, leftMinor: 70000, status: "ok", currency: "CZK", month })
    const quick = await bot(quickPOST, "POST", "/expenses/quick", { text: `20 Fun ${marker}` })
    expect(quick.json.status).toBe("created")
    expect(quick.json.limit).toMatchObject({ categoryId: cat.fun, spentMinor: 97000, leftMinor: 3000, percent: 97, status: "near" })
    // No limit, or no category: null.
    const plain = await bot(createPOST, "POST", "/expenses", { amountMinor: 100, categoryId: null, note: `misc ${marker}` })
    expect(plain.json.limit).toBeNull()
  })

  it("lists this month's limits for /limits", async () => {
    const { status, json } = await bot(limitsGET, "GET", "/limits")
    expect(status).toBe(200)
    expect(json.currency).toBe("CZK")
    expect(json.url).toMatch(/\/app\/budget\/limits$/)
    expect(mine(json.items as { name: string }[]).map((x) => x.name.replace(` ${marker}`, ""))).toEqual(["Fun", "Food"])
  })
})

describe("osbot API: limit alerts", () => {
  it("refuses unsigned calls", async () => {
    const { status } = await osbot(alerts.limitAlertsDueGET, "GET", "/budget-limits/due", undefined, false)
    expect(status).toBe(401)
  })

  it("announces 90 % once, then 'used up' once, settling the 90 % key with it", async () => {
    const first = await osbot(alerts.limitAlertsDueGET, "GET", "/budget-limits/due")
    expect(first.status).toBe(200)
    expect(first.json.url).toMatch(/\/app\/budget\/limits$/)
    const fun = (first.json.items as Json[]).find((x) => x.categoryId === cat.fun)
    expect(fun).toMatchObject({ threshold: 90, key: `${cat.fun}:${month}:90`, keys: [`${cat.fun}:${month}:90`], spentMinor: 97000 })
    // Food is at 88 %: nothing yet.
    expect((first.json.items as Json[]).some((x) => x.categoryId === cat.food)).toBe(false)

    expect((await osbot(alerts.limitAlertsAckPOST, "POST", "/budget-limits/ack", { keys: fun!.keys })).json).toEqual({ acked: 1 })
    const quiet = await osbot(alerts.limitAlertsDueGET, "GET", "/budget-limits/due")
    expect((quiet.json.items as Json[]).some((x) => x.categoryId === cat.fun)).toBe(false)

    // Food jumps from 88 % straight past 100 %: one "used up" alert, both keys settled.
    await spend(cat.food, 200000)
    await spend(cat.fun, 10000)
    const second = await osbot(alerts.limitAlertsDueGET, "GET", "/budget-limits/due")
    const food = (second.json.items as Json[]).find((x) => x.categoryId === cat.food)
    expect(food).toMatchObject({ threshold: 100, keys: [`${cat.food}:${month}:90`, `${cat.food}:${month}:100`], leftMinor: -130000 })
    const funOver = (second.json.items as Json[]).find((x) => x.categoryId === cat.fun)
    expect(funOver).toMatchObject({ threshold: 100, keys: [`${cat.fun}:${month}:100`] })
    const acked = await osbot(alerts.limitAlertsAckPOST, "POST", "/budget-limits/ack", { keys: [...food!.keys, ...funOver!.keys] })
    expect(acked.json).toEqual({ acked: 3 })
    const after = await osbot(alerts.limitAlertsDueGET, "GET", "/budget-limits/due")
    expect((after.json.items as Json[]).filter((x) => x.categoryId === cat.food || x.categoryId === cat.fun)).toEqual([])
  })

  it("skips keys for categories without the owner's limit and refuses malformed keys", async () => {
    const foreign = await osbot(alerts.limitAlertsAckPOST, "POST", "/budget-limits/ack", { keys: [`${bobCategory}:${month}:90`, `${cat.travel}:${month}:90`] })
    expect(foreign.json).toEqual({ acked: 0 })
    const bad = await osbot(alerts.limitAlertsAckPOST, "POST", "/budget-limits/ack", { keys: [`${cat.food}:${month}:50`] })
    expect(bad.status).toBe(400)
  })
})
