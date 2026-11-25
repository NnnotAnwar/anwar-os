// The morning brief end to end: osbot_settings (RLS, defaults), the "brief"
// kind on osbot_deliveries, and /api/internal/osbot/brief* as the site owner:
// the card with today's calendar, tasks, habits and money, once a day.
// `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}))

const SECRET = `brief-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/osbot/brief-routes")
const { actAs, loadViewer } = await import("@/core/auth")
const { readBriefSettings, saveBriefSettings } = await import("@/modules/osbot/brief")
const { asViewer } = await import("@/core/auth")
const { todayIn } = await import("@/modules/budget/lib/dates")
const { wallClock } = await import("@/modules/calendar/lib/zoned")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-brief-bob-${run}`
const marker = `brief-${run}`
const P = "/api/internal/osbot/brief"

type Handler = (request: Request) => Promise<Response>

async function call(handler: Handler, method: "GET" | "POST", path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const response = await handler(
    new Request(`http://127.0.0.1:3303${path}`, {
      method,
      headers: { "content-type": "application/json", ...signedHeaders(SECRET, { method, path, body: raw }) },
      body: method === "POST" ? raw : undefined,
    }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

function sqlAs<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
    return fn(sql)
  }) as Promise<T>
}

let owner = ""
let createdOwner = false
let timezone = "Europe/Prague"
let today = ""
let saved: Record<string, unknown> | undefined
let habit = ""
let task = ""

beforeAll(async () => {
  await admin`insert into auth."user" (id, name, email, email_verified) values (${bob}, ${bob}, ${`${bob}@test.local`}, true)`
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) owner = row.id
  else {
    owner = `test-brief-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  const [user] = await admin`select timezone from auth."user" where id = ${owner}`
  timezone = user!.timezone
  today = todayIn(timezone)
  ;[saved] = await admin`select * from osbot_settings where owner_id = ${owner}`
  await admin`delete from osbot_settings where owner_id = ${owner}`
  ;[{ id: habit }] = await admin<{ id: string }[]>`
    insert into habits_habits (owner_id, name, emoji, sort_order) values (${owner}, ${`Stretch ${marker}`}, '🧘', 9100) returning id`
  ;[{ id: task }] = await admin<{ id: string }[]>`
    insert into tasks_tasks (owner_id, title, due_date) values (${owner}, ${`Call the bank ${marker}`}, ${today}) returning id`
})

afterAll(async () => {
  await admin`delete from habits_habits where id = ${habit}`
  await admin`delete from tasks_tasks where id = ${task}`
  await admin`delete from osbot_settings where owner_id = ${owner}`
  if (saved) await admin`insert into osbot_settings ${admin(saved)}`
  await admin`delete from osbot_deliveries where owner_id = ${owner} and kind = 'brief' and key = ${today}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await admin`delete from auth."user" where id = ${bob}`
  await Promise.all([admin.end(), app.end()])
})

describe("osbot_settings", () => {
  it("is on at 08:00 without a row, and each user sees only their own", async () => {
    const bobViewer = await loadViewer(bob)
    expect(await actAs(bobViewer!, () => asViewer(readBriefSettings))).toEqual({ briefEnabled: true, briefTime: "08:00" })
    await actAs(bobViewer!, () => saveBriefSettings({ briefEnabled: false, briefTime: "07:15" }))
    expect(await actAs(bobViewer!, () => asViewer(readBriefSettings))).toEqual({ briefEnabled: false, briefTime: "07:15" })
    const [row] = await admin`select owner_id, brief_time::text from osbot_settings where owner_id = ${bob}`
    expect(row).toEqual({ owner_id: bob, brief_time: "07:15:00" })
    const others = await sqlAs(owner, (sql) => sql`select count(*)::int as n from osbot_settings where owner_id = ${bob}`)
    expect(others[0]!.n).toBe(0)
    const changed = await sqlAs(owner, (sql) => sql`update osbot_settings set brief_enabled = true where owner_id = ${bob}`)
    expect(changed.count).toBe(0)
    const anon = await sqlAs(null, (sql) => sql`select count(*)::int as n from osbot_settings`)
    expect(anon[0]!.n).toBe(0)
  })

  it("accepts the new delivery kinds and still refuses unknown ones", async () => {
    await sqlAs(bob, (sql) => sql`insert into osbot_deliveries (kind, key) values ('brief', '2026-11-25'), ('journal', '2026-11-25')`)
    let code: string | undefined
    try {
      await sqlAs(bob, (sql) => sql`insert into osbot_deliveries (kind, key) values ('nope', '2026-11-25')`)
    } catch (e) {
      code = (e as { code?: string }).code
    }
    expect(code).toBe("23514")
  })
})

describe("osbot brief API (as the site owner)", () => {
  it("rejects unsigned requests", async () => {
    expect((await routes.briefGET(new Request(`http://127.0.0.1:3303${P}`))).status).toBe(401)
  })

  it("shows today: the task due today with its id, the habit with its day", async () => {
    const { status, json } = await call(routes.briefGET, "GET", P)
    expect(status).toBe(200)
    expect(json.date).toBe(today)
    expect(json.url).toMatch(/\/app$/)
    expect(json.tasks.find((t: { id: string }) => t.id === task)).toMatchObject({ title: `Call the bank ${marker}`, overdue: false })
    expect(json.habits.date).toBe(today)
    expect(json.habits.habits.find((h: { id: string }) => h.id === habit)).toMatchObject({ emoji: "🧘", done: false })
    expect(json.clear).toBe(false)
    expect(typeof json.overdue).toBe("number")
  })

  it("goes out once a day inside its window, and not when switched off", async () => {
    // Off: never due.
    await admin`insert into osbot_settings (owner_id, brief_enabled, brief_time) values (${owner}, false, '00:00')`
    expect((await call(routes.briefDueGET, "GET", `${P}/due`)).json.due).toBe(false)

    // On, scheduled a minute ago (the owner's clock): due, with the brief.
    const w = wallClock(new Date(Date.now() - 60_000), timezone)
    const time = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`
    await admin`update osbot_settings set brief_enabled = true, brief_time = ${time} where owner_id = ${owner}`
    const due = await call(routes.briefDueGET, "GET", `${P}/due`)
    const date: string = due.json.date
    await admin`delete from osbot_deliveries where owner_id = ${owner} and kind = 'brief' and key = ${date}`
    const fresh = await call(routes.briefDueGET, "GET", `${P}/due`)
    expect(fresh.json).toMatchObject({ due: true, date, time })
    expect(fresh.json.brief.delivered).toBe(false)

    expect((await call(routes.briefAckPOST, "POST", `${P}/ack`, { date })).json).toEqual({ acked: 1 })
    expect((await call(routes.briefAckPOST, "POST", `${P}/ack`, { date })).json).toEqual({ acked: 0 })
    expect((await call(routes.briefDueGET, "GET", `${P}/due`)).json).toMatchObject({ due: false, brief: null })
    expect((await call(routes.briefGET, "GET", P)).json.delivered).toBe(date === today)
    await admin`delete from osbot_deliveries where owner_id = ${owner} and kind = 'brief' and key = ${date}`
  })

  it("skips a brief more than three hours late", async () => {
    const w = wallClock(new Date(Date.now() - 4 * 3600_000), timezone)
    const time = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`
    await admin`update osbot_settings set brief_enabled = true, brief_time = ${time} where owner_id = ${owner}`
    expect((await call(routes.briefDueGET, "GET", `${P}/due`)).json.due).toBe(false)
  })

  it("refuses a malformed ack", async () => {
    expect((await call(routes.briefAckPOST, "POST", `${P}/ack`, { date: "tomorrow" })).status).toBe(400)
  })
})
