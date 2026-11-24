// Habits: RLS on habits_habits, habits_checks and habits_settings, and the osbot
// endpoints (/api/internal/osbot/habits/*) end to end: the /habits card, toggling
// from Telegram, reminders and the evening nudge going out once. `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

// The handlers start with `await connection()`; outside Next it is stubbed.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}))

const SECRET = `habits-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/habits/osbot-routes")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-habits-alice-${run}`
const bob = `test-habits-bob-${run}`
const marker = `habit-${run}`

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

let aliceHabit = ""
let bobHabit = ""

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await admin`
      insert into auth."user" (id, name, email, email_verified)
      values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
  ;[{ id: aliceHabit }] = await as(alice, (sql) => sql<{ id: string }[]>`
    insert into habits_habits (name) values (${`Read ${marker}`}) returning id`)
  ;[{ id: bobHabit }] = await as(bob, (sql) => sql<{ id: string }[]>`
    insert into habits_habits (name) values (${`Run ${marker}`}) returning id`)
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await admin`delete from habits_habits where name like ${`%${marker}%`}`
  await Promise.all([admin.end(), app.end()])
})

describe("habits RLS", () => {
  it("creates a habit for the viewer with sensible defaults", async () => {
    const [habit] = await as(alice, (sql) => sql`
      select owner_id, weekdays, emoji, reminder_time, archived_at from habits_habits where id = ${aliceHabit}`)
    expect(habit).toEqual({ owner_id: alice, weekdays: 127, emoji: "", reminder_time: null, archived_at: null })
  })

  it("hides one user's habits, checks and settings from another and from anonymous sessions", async () => {
    await as(alice, (sql) => sql`insert into habits_checks (habit_id, day) values (${aliceHabit}, '2026-11-20')`)
    await as(alice, (sql) => sql`insert into habits_settings (nudge_enabled) values (true)`)
    const bobSees = await as(bob, (sql) => sql`
      select (select count(*)::int from habits_habits where owner_id = ${alice}) as habits,
             (select count(*)::int from habits_checks where owner_id = ${alice}) as checks,
             (select count(*)::int from habits_settings where owner_id = ${alice}) as settings`)
    expect(bobSees[0]).toEqual({ habits: 0, checks: 0, settings: 0 })
    const anon = await as(null, (sql) => sql`
      select (select count(*)::int from habits_habits) + (select count(*)::int from habits_checks) as n`)
    expect(anon[0]!.n).toBe(0)
  })

  it("never lets anyone else change or delete the owner's habits, checks or settings", async () => {
    const result = await as(bob, async (sql) => ({
      renamed: (await sql`update habits_habits set name = 'x' where id = ${aliceHabit}`).count,
      deleted: (await sql`delete from habits_habits where id = ${aliceHabit}`).count,
      unchecked: (await sql`delete from habits_checks where habit_id = ${aliceHabit}`).count,
      settings: (await sql`update habits_settings set nudge_enabled = false where owner_id = ${alice}`).count,
    }))
    expect(result).toEqual({ renamed: 0, deleted: 0, unchecked: 0, settings: 0 })
  })

  it("refuses checking someone else's habit, even by a guessed id", async () => {
    expect(await pgError(as(alice, (sql) => sql`insert into habits_checks (habit_id, day) values (${bobHabit}, '2026-11-20')`))).toBe(
      "23503",
    )
    expect(
      await pgError(as(alice, (sql) => sql`insert into habits_checks (owner_id, habit_id, day) values (${bob}, ${bobHabit}, '2026-11-20')`)),
    ).toBe("42501")
  })

  it("allows one check per habit per day, and a check can't be edited", async () => {
    expect(await pgError(as(alice, (sql) => sql`insert into habits_checks (habit_id, day) values (${aliceHabit}, '2026-11-20')`))).toBe(
      "23505",
    )
    expect(await pgError(as(alice, (sql) => sql`update habits_checks set day = '2026-11-21' where habit_id = ${aliceHabit}`))).toBe(
      "42501",
    )
  })

  it("rejects an empty schedule and an overlong name", async () => {
    expect(await pgError(as(alice, (sql) => sql`insert into habits_habits (name, weekdays) values ('x', 0)`))).toBe("23514")
    expect(await pgError(as(alice, (sql) => sql`insert into habits_habits (name) values (${"x".repeat(81)})`))).toBe("23514")
  })

  it("deleting a habit deletes its history", async () => {
    const [{ id }] = await as(alice, (sql) => sql<{ id: string }[]>`insert into habits_habits (name) values (${`Gone ${marker}`}) returning id`)
    await as(alice, (sql) => sql`insert into habits_checks (habit_id, day) values (${id}, '2026-11-19')`)
    await as(alice, (sql) => sql`delete from habits_habits where id = ${id}`)
    const [left] = await admin`select count(*)::int as n from habits_checks where habit_id = ${id}`
    expect(left!.n).toBe(0)
  })
})

describe("osbot habits API (as the site owner)", () => {
  let owner = ""
  let createdOwner = false
  let saved: Record<string, unknown> | undefined
  let morning = ""
  let evening = ""
  let today = ""

  beforeAll(async () => {
    const [row] = await admin`select app.site_owner_id() as id`
    if (row?.id) owner = row.id
    else {
      owner = `test-habits-owner-${run}`
      createdOwner = true
      await admin`
        insert into auth."user" (id, name, email, email_verified, role)
        values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
    }
    ;[saved] = await admin`select * from habits_settings where owner_id = ${owner}`
    await admin`delete from habits_settings where owner_id = ${owner}`
    // Reminder at 00:00, so it is always due; the evening nudge at 00:00 too, switched on.
    ;[{ id: morning }] = await admin<{ id: string }[]>`
      insert into habits_habits (owner_id, name, emoji, reminder_time, sort_order)
      values (${owner}, ${`Stretch ${marker}`}, '🧘', '00:00', 9001) returning id`
    ;[{ id: evening }] = await admin<{ id: string }[]>`
      insert into habits_habits (owner_id, name, sort_order) values (${owner}, ${`Journal ${marker}`}, 9002) returning id`
    await admin`insert into habits_settings (owner_id, nudge_enabled, nudge_time) values (${owner}, true, '00:00')`
  })

  afterAll(async () => {
    await admin`delete from habits_habits where id in (${morning}, ${evening})`
    await admin`delete from habits_settings where owner_id = ${owner}`
    if (saved) await admin`insert into habits_settings ${admin(saved)}`
    if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  })

  const mine = <T extends { name: string }>(habits: T[]) => habits.filter((h) => h.name.includes(marker))

  it("rejects unsigned requests", async () => {
    const response = await routes.habitsGET(new Request("http://127.0.0.1:3303/api/internal/osbot/habits"))
    expect(response.status).toBe(401)
  })

  it("shows today's habits on the /habits card", async () => {
    const { status, json } = await call(routes.habitsGET, "GET", "/api/internal/osbot/habits")
    expect(status).toBe(200)
    today = json.today
    expect(json.date).toBe(today)
    expect(json.url).toMatch(/\/app\/habits$/)
    expect(mine(json.habits)).toEqual([
      { id: morning, name: `Stretch ${marker}`, emoji: "🧘", done: false, current: 0 },
      { id: evening, name: `Journal ${marker}`, emoji: "", done: false, current: 0 },
    ])
  })

  it("never shows Bob's habits to the bot", async () => {
    const { json } = await call(routes.habitsGET, "GET", "/api/internal/osbot/habits")
    expect(json.habits.map((h: { id: string }) => h.id)).not.toContain(bobHabit)
  })

  it("toggles a habit from Telegram and redraws the card", async () => {
    const on = await call(routes.habitsTogglePOST, "POST", "/api/internal/osbot/habits/toggle", { id: morning })
    expect(on.status).toBe(200)
    expect(on.json.toggled).toEqual({ id: morning, done: true, name: `Stretch ${marker}` })
    expect(mine(on.json.habits)[0]).toMatchObject({ done: true, current: 1 })
    const off = await call(routes.habitsTogglePOST, "POST", "/api/internal/osbot/habits/toggle", { id: morning, date: today })
    expect(off.json.toggled.done).toBe(false)
  })

  it("explains what can't be toggled", async () => {
    const future = await call(routes.habitsTogglePOST, "POST", "/api/internal/osbot/habits/toggle", { id: morning, date: "2999-01-01" })
    expect(future.status).toBe(422)
    expect(future.json.message).toMatch(/hasn't come yet/)
    const foreign = await call(routes.habitsTogglePOST, "POST", "/api/internal/osbot/habits/toggle", { id: bobHabit })
    expect(foreign.status).toBe(422)
  })

  it("sends a habit's reminder and the evening nudge once", async () => {
    const first = await call(routes.habitsNudgesGET, "GET", "/api/internal/osbot/habits/nudges")
    expect(first.status).toBe(200)
    expect(first.json.date).toBe(today)
    expect(mine(first.json.reminders)).toEqual([{ id: morning, name: `Stretch ${marker}`, emoji: "🧘", time: "00:00" }])
    expect(first.json.evening.time).toBe("00:00")
    expect(mine<{ id: string; name: string }>(first.json.evening.habits).map((h) => h.id)).toEqual([morning, evening])

    const ack = await call(routes.habitsNudgesAckPOST, "POST", "/api/internal/osbot/habits/nudges/ack", {
      date: today,
      reminders: [morning],
      evening: true,
    })
    expect(ack.json.acked).toBe(2)

    const again = await call(routes.habitsNudgesGET, "GET", "/api/internal/osbot/habits/nudges")
    expect(mine(again.json.reminders)).toEqual([])
    expect(again.json.evening).toBeNull()
  })

  it("doesn't remind about a habit that's already done", async () => {
    await admin`update habits_habits set last_reminded_on = null where id = ${morning}`
    await call(routes.habitsTogglePOST, "POST", "/api/internal/osbot/habits/toggle", { id: morning })
    const { json } = await call(routes.habitsNudgesGET, "GET", "/api/internal/osbot/habits/nudges")
    expect(mine(json.reminders)).toEqual([])
  })
})
