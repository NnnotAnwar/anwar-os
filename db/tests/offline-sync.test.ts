// The offline sync API (POST /api/sync/<kind>, src/core/offline-sync.ts) against
// the real module tables: each kind saves once however often it is sent (the
// item's id is the row's id), relative dates count from the capture day,
// refusals come back as 422 with the module's message, and nobody can file an
// item under someone else or from another site. `pnpm test:db`.
import { randomBytes, randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Outside Next there is no request scope: no cookies (so no session) and no
// cache to revalidate.
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  headers: async () => new Headers(),
}))
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}))

const { handleSync } = await import("@/core/offline-sync")
const { actAs } = await import("@/core/auth")
const { runModuleAction } = await import("@/core/module-actions")
const { formatIsoDate, addDays, parseIsoDate } = await import("@/modules/calendar/lib/zoned")
const { captureDay } = await import("@/lib/offline/capture-day")
type Viewer = Parameters<typeof actAs>[0]

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-sync-alice-${run}`
const bob = `test-sync-bob-${run}`
const ORIGIN = "http://127.0.0.1:3303"
const TZ = "Europe/Prague"

const viewer = (id: string): Viewer => ({
  id,
  email: `${id}@test.local`,
  role: "owner",
  displayName: id,
  isAnonymous: false,
  twoFactorEnabled: false,
  timezone: TZ,
  locale: "en",
})

function request(kind: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/sync/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify(body),
  })
}

async function send(as: string | null, kind: string, body: unknown, headers?: Record<string, string>) {
  const call = () => handleSync(request(kind, body, headers), kind)
  const response = await (as ? actAs(viewer(as), call) : call())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

const item = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  userId: alice,
  capturedAt: new Date().toISOString(),
  payload,
  ...extra,
})

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const shift = (iso: string, days: number) => formatIsoDate(addDays(parseIsoDate(iso)!, days))

beforeAll(async () => {
  await admin`
    insert into auth."user" (id, name, email, email_verified, timezone)
    values (${alice}, 'Alice', ${`${alice}@test.local`}, true, ${TZ}),
           (${bob}, 'Bob', ${`${bob}@test.local`}, true, ${TZ})`
  // Budget's defaults (an account, categories) for the quick expense.
  await actAs(viewer(alice), () => runModuleAction("budget", "ensureSetup", {}))
})

afterAll(async () => {
  await admin`delete from budget_transactions where owner_id in (${alice}, ${bob})`
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await admin.end()
})

describe("offline sync: each kind saves exactly once", () => {
  it("inbox", async () => {
    const body = item({ text: "Call Petra https://example.com/a" })
    const first = await send(alice, "inbox", body)
    const again = await send(alice, "inbox", body)
    expect(first.status).toBe(200)
    expect(first.json.value).toMatchObject({ id: body.id, text: "Call Petra", url: "https://example.com/a" })
    expect(again.json.value).toEqual(first.json.value)
    const rows = await admin`select owner_id from inbox_items where id = ${body.id}`
    expect(rows).toEqual([{ owner_id: alice }])
  })

  it("task, with 'tomorrow' counted from the day it was captured", async () => {
    const capturedAt = daysAgo(2)
    const body = item({ text: `Pay rent tomorrow ${run}`, listId: null, dueToday: false }, { capturedAt })
    const first = await send(alice, "task", body)
    const again = await send(alice, "task", body)
    expect(first.status).toBe(200)
    expect(first.json.value).toMatchObject({ id: body.id, title: `Pay rent ${run}`, dueDate: shift(captureDay(capturedAt, TZ), 1) })
    expect(again.json.value.id).toBe(body.id)
    expect(await admin`select id from tasks_tasks where owner_id = ${alice} and title = ${`Pay rent ${run}`}`).toHaveLength(1)
  })

  it("note", async () => {
    const body = item({ title: `Offline note ${run}`, body: "Written on the train" })
    const first = await send(alice, "note", body)
    const again = await send(alice, "note", body)
    expect(first.json.value).toMatchObject({ id: body.id })
    expect(again.json.value).toEqual(first.json.value)
    expect(await admin`select body from notes_notes where owner_id = ${alice} and title = ${`Offline note ${run}`}`).toEqual([
      { body: "Written on the train" },
    ])
  })

  it("quick expense, with 'yesterday' counted from the day it was captured", async () => {
    const capturedAt = daysAgo(3)
    const body = item({ text: `250 coffee ${run} yesterday` }, { capturedAt })
    const first = await send(alice, "expense", body)
    const again = await send(alice, "expense", body)
    expect(first.status).toBe(200)
    expect(first.json.value).toMatchObject({ id: body.id, amountMinor: -25000, occurredOn: shift(captureDay(capturedAt, TZ), -1) })
    expect(again.json.value).toEqual(first.json.value)
    expect(await admin`select id from budget_transactions where owner_id = ${alice} and note like ${`%${run}%`}`).toHaveLength(1)
  })
})

describe("offline sync: refusals", () => {
  it("passes the module's own message back as 422", async () => {
    const result = await send(alice, "expense", item({ text: "coffee" }))
    expect(result.status).toBe(422)
    expect(result.json.message).toEqual(expect.any(String))
    const empty = await send(alice, "task", item({ text: "   " }))
    expect(empty.status).toBe(422)
  })

  it("answers 401 without a session", async () => {
    expect((await send(null, "inbox", item({ text: "x" }))).status).toBe(401)
  })

  it("never files one user's capture under another's session", async () => {
    const body = item({ text: `Alice's thought ${run}` })
    const result = await send(bob, "inbox", body)
    expect(result).toMatchObject({ status: 409, json: { error: "other_user" } })
    expect(await admin`select id from inbox_items where id = ${body.id}`).toEqual([])
  })

  it("can't reuse another user's id to read their row", async () => {
    const body = item({ text: `Mine ${run}` })
    expect((await send(alice, "inbox", body)).status).toBe(200)
    const stolen = await send(bob, "inbox", { ...body, userId: bob, payload: { text: "Bob's" } })
    expect(stolen.status).toBe(409)
    expect(stolen.json.error).toBe("conflict")
    expect(await admin`select owner_id, text from inbox_items where id = ${body.id}`).toEqual([{ owner_id: alice, text: `Mine ${run}` }])
  })

  it("refuses other sites, forms and unknown kinds", async () => {
    expect((await send(alice, "inbox", item({ text: "x" }), { origin: "https://evil.example" })).status).toBe(403)
    expect((await send(alice, "inbox", item({ text: "x" }), { "sec-fetch-site": "cross-site" })).status).toBe(403)
    expect((await send(alice, "inbox", item({ text: "x" }), { "content-type": "text/plain" })).status).toBe(403)
    expect((await send(alice, "link", item({ url: "https://example.com" }))).status).toBe(404)
    expect((await send(alice, "inbox", { ...item({ text: "x" }), id: "not-a-uuid" })).status).toBe(400)
  })
})
