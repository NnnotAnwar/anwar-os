// Budget subscriptions and what reads them, end to end: Budget's own actions
// (subscriptions, upcomingPayments, setRecurringSubscription), osbot's
// scheduled digests (payments/due + payments/ack the day before a charge, the
// weekly review: weekly + weekly/ack), the expense bot's GET subscriptions, and
// RLS on osbot_deliveries and budget_recurring. `pnpm test:db`.
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

const SECRET = `osbot-digest-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
const BUDGET_SECRET = `budget-bot-subs-${randomBytes(24).toString("hex")}`
process.env.BOT_EXPENSES_API_SECRET = BUDGET_SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/osbot/digest-routes")
const { subscriptionsGET } = await import("@/modules/budget/bot-api/subscriptions")
const { actAs, loadViewer } = await import("@/core/auth")
const { actions } = await import("@/modules/budget/actions")
const { addDaysIso, todayIn } = await import("@/modules/budget/lib/dates")
const { shiftWeek, weekOf } = await import("@/modules/osbot/lib/week")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-digest-bob-${run}`
const marker = `digest-${run}`
let owner = ""
let createdOwner = false
let ownerAccount = ""
let bobRecurring = ""
const ids: Record<string, string> = {}
let today = ""
let tomorrow = ""

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

type Handler = (request: Request) => Promise<Response>
const P = "/api/internal/osbot"

async function call(handler: Handler, method: "GET" | "POST", path: string, body?: unknown, sign = true) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers = sign ? signedHeaders(SECRET, { method, path: `${P}${path}`, body: raw }) : {}
  const response = await handler(
    new Request(`http://127.0.0.1:3303${P}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "POST" ? raw : undefined,
    }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

async function asOwner<T>(fn: () => Promise<T>) {
  const viewer = await loadViewer(owner)
  return actAs(viewer!, fn)
}

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-digest-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`insert into auth."user" (id, name, email, email_verified) values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  const viewer = await loadViewer(owner)
  today = todayIn(viewer!.timezone)
  tomorrow = addDaysIso(today, 1)
  const nextMonday = shiftWeek(weekOf(today), 1).start

  const [acc] = await admin`
    insert into budget_accounts (owner_id, name, currency) values (${owner}, ${`Digest bank ${marker}`}, 'CZK') returning id`
  ownerAccount = acc!.id
  const recurring = async (who: string, account: string, note: string, amount: number, start: string, extra: { freq?: string; subscription?: boolean; active?: boolean } = {}) => {
    const [r] = await admin`
      insert into budget_recurring (owner_id, account_id, amount_minor, note, freq, start_on, next_due, subscription, active)
      values (${who}, ${account}, ${amount}, ${`${note} ${marker}`}, ${extra.freq ?? "monthly"}, ${start}, ${start},
              ${extra.subscription ?? false}, ${extra.active ?? true})
      returning id`
    return r!.id as string
  }
  ids.netflix = await recurring(owner, ownerAccount, "Netflix", -29900, tomorrow, { subscription: true })
  ids.rent = await recurring(owner, ownerAccount, "Rent", -1800000, tomorrow)
  ids.paused = await recurring(owner, ownerAccount, "Paused gym", -99000, tomorrow, { subscription: true, active: false })
  ids.salary = await recurring(owner, ownerAccount, "Salary", 4500000, tomorrow)
  ids.gym = await recurring(owner, ownerAccount, "Climbing", -25000, nextMonday, { freq: "weekly", subscription: true })
  // Spent today, for the weekly review.
  await admin`
    insert into budget_transactions (owner_id, account_id, amount_minor, occurred_on, note)
    values (${owner}, ${ownerAccount}, -45000, ${today}, ${`Groceries ${marker}`})`

  const [bobAcc] = await admin`insert into budget_accounts (owner_id, name, currency) values (${bob}, 'Bob bank', 'CZK') returning id`
  bobRecurring = await recurring(bob, bobAcc!.id, "Bob's Spotify", -16900, tomorrow, { subscription: true })
})

afterAll(async () => {
  await admin`delete from osbot_deliveries where owner_id in (${owner}, ${bob})`
  await admin`delete from budget_recurring where owner_id in (${owner}, ${bob})`
  await admin`delete from budget_transactions where account_id = ${ownerAccount}`
  await admin`delete from budget_accounts where id = ${ownerAccount}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("budget: subscriptions", () => {
  it("lists recurring expenses with their next charge and cost, totalling subscriptions only", async () => {
    const data = await asOwner(() => actions.subscriptions.handler({}))
    const mine = data.items.filter((i) => i.note.endsWith(marker))
    // Active ones by next charge (then name), paused ones last.
    const charges = mine.map((i) => i.nextCharge ?? "9999-12-31")
    expect(charges).toEqual([...charges].sort())
    expect(mine.at(-1)!.id).toBe(ids.paused)
    expect(mine.map((i) => i.id).slice(0, 2)).toEqual(tomorrow === shiftWeek(weekOf(today), 1).start ? [ids.gym, ids.netflix] : [ids.netflix, ids.rent])
    const netflix = mine.find((i) => i.id === ids.netflix)!
    expect(netflix).toMatchObject({ subscription: true, nextCharge: tomorrow, monthlyMinor: 29900, yearlyMinor: 358800 })
    expect(mine.find((i) => i.id === ids.paused)!.nextCharge).toBeNull()
    // Income is never listed; Bob's rows never.
    expect(data.items.some((i) => i.id === ids.salary || i.id === bobRecurring)).toBe(false)
    const czk = data.subscriptions.find((t) => t.currency === "CZK")!
    const all = data.allRecurring.find((t) => t.currency === "CZK")!
    // Rent is in "all recurring", not in subscriptions.
    expect(all.monthlyMinor - czk.monthlyMinor).toBeGreaterThanOrEqual(1800000)
  })

  it("lists upcoming charges, leaving out paused templates and income", async () => {
    const next = await asOwner(() => actions.upcomingPayments.handler({ from: tomorrow, to: tomorrow, days: 7, subscriptionsOnly: false }))
    const mine = next.filter((p) => p.note.endsWith(marker) && p.recurringId !== ids.gym).map((p) => [p.note.replace(` ${marker}`, ""), p.amountMinor, p.date])
    expect(mine).toEqual([
      ["Netflix", 29900, tomorrow],
      ["Rent", 1800000, tomorrow],
    ])
    const subsOnly = await asOwner(() => actions.upcomingPayments.handler({ from: tomorrow, to: tomorrow, days: 7, subscriptionsOnly: true }))
    expect(subsOnly.filter((p) => p.note.endsWith(marker) && p.recurringId !== ids.gym).map((p) => p.recurringId)).toEqual([ids.netflix])
  })

  it("marks only expenses as subscriptions, and keeps the flag when an update leaves it out", async () => {
    await expect(asOwner(() => actions.setRecurringSubscription.handler({ id: ids.salary, subscription: true }))).rejects.toThrow(
      "Only a recurring expense",
    )
    await asOwner(() => actions.setRecurringSubscription.handler({ id: ids.rent, subscription: true }))
    await asOwner(() =>
      actions.updateRecurring.handler({
        id: ids.rent,
        accountId: ownerAccount,
        categoryId: null,
        amountMinor: -1850000,
        note: `Rent ${marker}`,
        tags: [],
        freq: "monthly",
        interval: 1,
        startOn: tomorrow,
        endOn: null,
      }),
    )
    const [row] = await admin`select subscription, amount_minor from budget_recurring where id = ${ids.rent}`
    expect(row).toMatchObject({ subscription: true, amount_minor: "-1850000" })
    await asOwner(() => actions.setRecurringSubscription.handler({ id: ids.rent, subscription: false }))
  })

  it("never lets another user read or flag the owner's templates", async () => {
    expect(await as(bob, (sql) => sql`select 1 from budget_recurring where id = ${ids.netflix}`)).toHaveLength(0)
    const updated = await as(bob, (sql) => sql`update budget_recurring set subscription = false where id = ${ids.netflix} returning id`)
    expect(updated).toHaveLength(0)
  })
})

describe("osbot API: payment reminders", () => {
  it("refuses unsigned calls", async () => {
    const { status } = await call(routes.paymentsDueGET, "GET", "/payments/due", undefined, false)
    expect(status).toBe(401)
  })

  it("lists tomorrow's charges once, then nothing after the ack", async () => {
    const first = await call(routes.paymentsDueGET, "GET", "/payments/due")
    expect(first.status).toBe(200)
    expect(first.json.date).toBe(tomorrow)
    expect(first.json.url).toMatch(/\/app\/budget\/subscriptions$/)
    const mine = (first.json.items as { key: string; title: string; amountMinor: number; recurringId: string }[]).filter((i) => i.title.endsWith(marker) && i.recurringId !== ids.gym)
    expect(mine.map((i) => [i.title.replace(` ${marker}`, ""), i.amountMinor])).toEqual([
      ["Netflix", 29900],
      ["Rent", 1850000],
    ])
    expect(mine[0]!.key).toBe(`${ids.netflix}:${tomorrow}`)

    const ack = await call(routes.paymentsAckPOST, "POST", "/payments/ack", { keys: [mine[0]!.key] })
    expect(ack.json).toEqual({ acked: 1 })
    const again = await call(routes.paymentsAckPOST, "POST", "/payments/ack", { keys: [mine[0]!.key] })
    expect(again.json).toEqual({ acked: 0 })

    const second = await call(routes.paymentsDueGET, "GET", "/payments/due")
    const left = (second.json.items as { recurringId: string }[]).map((i) => i.recurringId)
    expect(left).toContain(ids.rent)
    expect(left).not.toContain(ids.netflix)
  })

  it("skips keys of templates the owner can't see and refuses malformed keys", async () => {
    const foreign = await call(routes.paymentsAckPOST, "POST", "/payments/ack", { keys: [`${bobRecurring}:${tomorrow}`] })
    expect(foreign.json).toEqual({ acked: 0 })
    const bad = await call(routes.paymentsAckPOST, "POST", "/payments/ack", { keys: ["not-a-key"] })
    expect(bad.status).toBe(400)
  })
})

describe("osbot API: weekly review", () => {
  it("summarises the week and is idempotent through weekly/ack", async () => {
    const week = weekOf(today)
    const first = await call(routes.weeklyGET, "GET", "/weekly")
    expect(first.status).toBe(200)
    const review = first.json
    expect(review.week).toMatchObject({ start: week.start, end: week.end, key: week.start })
    expect(review.nextWeek.start).toBe(shiftWeek(week, 1).start)
    expect(review.delivered).toBe(false)
    expect(review.spending.currency).toBe("CZK")
    expect(review.spending.thisWeekMinor).toBeGreaterThanOrEqual(45000)
    expect(review.spending.top.length).toBeGreaterThan(0)
    const nextWeek = (review.payments.items as { title: string }[]).map((p) => p.title)
    expect(nextWeek).toContain(`Climbing ${marker}`)
    expect(review.tasks).toMatchObject({ done: expect.any(Number), added: expect.any(Number), overdue: expect.any(Number) })
    expect(review.captured).toMatchObject({ ideas: expect.any(Number), notes: expect.any(Number) })

    expect((await call(routes.weeklyAckPOST, "POST", "/weekly/ack", { week: week.start })).json).toEqual({ acked: 1 })
    expect((await call(routes.weeklyAckPOST, "POST", "/weekly/ack", { week: week.start })).json).toEqual({ acked: 0 })
    expect((await call(routes.weeklyGET, "GET", "/weekly")).json.delivered).toBe(true)
    // Another week isn't affected.
    const before = shiftWeek(week, -1).start
    expect((await call(routes.weeklyGET, "GET", `/weekly?date=${before}`)).json.delivered).toBe(false)
  })

  it("only takes a Monday as the week to ack", async () => {
    const { status } = await call(routes.weeklyAckPOST, "POST", "/weekly/ack", { week: addDaysIso(weekOf(today).start, 2) })
    expect(status).toBe(400)
  })
})

describe("osbot deliveries: RLS", () => {
  it("hides the owner's deliveries from others and refuses rows forged for them", async () => {
    expect(await as(bob, (sql) => sql`select 1 from osbot_deliveries where owner_id = ${owner}`)).toHaveLength(0)
    expect(await as(null, (sql) => sql`select 1 from osbot_deliveries`)).toHaveLength(0)
    const forged = await pgError(as(bob, (sql) => sql`insert into osbot_deliveries (owner_id, kind, key) values (${owner}, 'weekly', '2026-01-05')`))
    expect(forged).toBe("42501")
    const anonymous = await pgError(as(null, (sql) => sql`insert into osbot_deliveries (kind, key) values ('weekly', '2026-01-05')`))
    expect(anonymous).not.toBeNull()
    // Nothing to update: the table is append-only for the app.
    const update = await pgError(as(owner, (sql) => sql`update osbot_deliveries set key = 'x'`))
    expect(update).toBe("42501")
    const deleted = await as(bob, (sql) => sql`delete from osbot_deliveries where owner_id = ${owner} returning id`)
    expect(deleted).toHaveLength(0)
  })

  it("rejects unknown kinds and empty keys", async () => {
    expect(await pgError(as(owner, (sql) => sql`insert into osbot_deliveries (kind, key) values ('other', 'x')`))).toBe("23514")
    expect(await pgError(as(owner, (sql) => sql`insert into osbot_deliveries (kind, key) values ('weekly', '')`))).toBe("23514")
  })
})

describe("budget-bot API: subscriptions", () => {
  const path = "/api/internal/budget-bot/subscriptions"
  const get = (headers: Record<string, string>) => subscriptionsGET(new Request(`http://127.0.0.1:3303${path}`, { headers }))

  it("refuses osbot's signature (each bot has its own secret)", async () => {
    const response = await get(signedHeaders(SECRET, { method: "GET", path, body: "" }))
    expect(response.status).toBe(401)
  })

  it("lists the owner's recurring expenses with cadence, next charge and totals", async () => {
    const response = await get(budgetBotHeaders(BUDGET_SECRET, { method: "GET", path, body: "" }, BUDGET_BOT_SIGNATURE_HEADERS))
    expect(response.status).toBe(200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as Record<string, any>
    expect(json.currency).toBe("CZK")
    expect(json.url).toMatch(/\/app\/budget\/subscriptions$/)
    const netflix = json.items.find((i: { id: string }) => i.id === ids.netflix)
    expect(netflix).toMatchObject({ title: `Netflix ${marker}`, amountMinor: 29900, cadence: "Every month", nextCharge: tomorrow, monthlyMinor: 29900, subscription: true, active: true })
    expect(json.items.find((i: { id: string }) => i.id === ids.gym)).toMatchObject({ cadence: "Every week", monthlyMinor: 108333 })
    const ids_ = json.items.map((i: { id: string }) => i.id)
    expect(ids_).not.toContain(bobRecurring)
    expect(ids_).not.toContain(ids.salary)
    expect(json.subscriptions[0]).toMatchObject({ currency: "CZK" })
  })
})
