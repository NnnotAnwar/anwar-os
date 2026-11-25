// Journal: RLS on journal_entries and journal_settings, the module actions
// (upsert / list / delete / stats, ⌘K search), the "journal" kind on
// osbot_deliveries, the monthly report's journal section, and osbot's
// /api/internal/osbot/journal/* end to end. `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

// The handlers start with `await connection()`; outside Next it is stubbed.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}))

const SECRET = `journal-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/journal/osbot-routes")
const { actAs, loadViewer } = await import("@/core/auth")
const { actions } = await import("@/modules/journal/actions")
const { search } = await import("@/modules/journal/search")
const { monthlyReport } = await import("@/modules/review/report")
const { addDaysIso, todayIn } = await import("@/modules/budget/lib/dates")
const { wallClock } = await import("@/modules/calendar/lib/zoned")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-journal-alice-${run}`
const bob = `test-journal-bob-${run}`
const marker = `journal-${run}`

function sqlAs<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function as<T>(who: string, fn: () => Promise<T>) {
  const viewer = await loadViewer(who)
  return actAs(viewer!, fn)
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

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await admin`
      insert into auth."user" (id, name, email, email_verified)
      values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
  await sqlAs(alice, (sql) => sql`insert into journal_entries (day, mood, text) values ('2026-11-20', 4, ${`Good walk ${marker}`})`)
  await sqlAs(bob, (sql) => sql`insert into journal_entries (day, mood, text) values ('2026-11-20', 1, ${`Bob's bad day ${marker}`})`)
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("journal RLS", () => {
  it("writes an entry for the viewer", async () => {
    const [row] = await sqlAs(alice, (sql) => sql`select owner_id, mood, text from journal_entries where day = '2026-11-20'`)
    expect(row).toEqual({ owner_id: alice, mood: 4, text: `Good walk ${marker}` })
  })

  it("hides one user's entries and settings from another and from anonymous sessions", async () => {
    await sqlAs(alice, (sql) => sql`insert into journal_settings (prompt_enabled) values (false)`)
    const bobSees = await sqlAs(bob, (sql) => sql`
      select (select count(*)::int from journal_entries where owner_id = ${alice}) as entries,
             (select count(*)::int from journal_settings where owner_id = ${alice}) as settings`)
    expect(bobSees[0]).toEqual({ entries: 0, settings: 0 })
    const anon = await sqlAs(null, (sql) => sql`select (select count(*)::int from journal_entries) + (select count(*)::int from journal_settings) as n`)
    expect(anon[0]!.n).toBe(0)
  })

  it("never lets anyone else change, delete or claim the owner's rows", async () => {
    const result = await sqlAs(bob, async (sql) => ({
      edited: (await sql`update journal_entries set text = 'x' where owner_id = ${alice}`).count,
      deleted: (await sql`delete from journal_entries where owner_id = ${alice}`).count,
      settings: (await sql`update journal_settings set prompt_enabled = true where owner_id = ${alice}`).count,
    }))
    expect(result).toEqual({ edited: 0, deleted: 0, settings: 0 })
    expect(await pgError(sqlAs(bob, (sql) => sql`insert into journal_entries (owner_id, day, mood) values (${alice}, '2026-11-21', 3)`))).toBe("42501")
    expect(await pgError(sqlAs(bob, (sql) => sql`update journal_entries set owner_id = ${alice} where owner_id = ${bob}`))).toBe("42501")
  })

  it("keeps one entry per day, a mood from 1 to 5, a line under 500 and never an empty entry", async () => {
    expect(await pgError(sqlAs(alice, (sql) => sql`insert into journal_entries (day, mood) values ('2026-11-20', 3)`))).toBe("23505")
    expect(await pgError(sqlAs(alice, (sql) => sql`insert into journal_entries (day, mood) values ('2026-11-01', 6)`))).toBe("23514")
    expect(await pgError(sqlAs(alice, (sql) => sql`insert into journal_entries (day, text) values ('2026-11-01', ${"x".repeat(501)})`))).toBe("23514")
    expect(await pgError(sqlAs(alice, (sql) => sql`insert into journal_entries (day) values ('2026-11-01')`))).toBe("23514")
    // Bob's entry on the same day is his own row.
    const [n] = await admin`select count(*)::int as n from journal_entries where day = '2026-11-20' and owner_id in (${alice}, ${bob})`
    expect(n!.n).toBe(2)
  })

  it("deletes a user's journal with the user", async () => {
    const temp = `test-journal-temp-${run}`
    await admin`insert into auth."user" (id, name, email, email_verified) values (${temp}, ${temp}, ${`${temp}@test.local`}, true)`
    await sqlAs(temp, (sql) => sql`insert into journal_entries (day, mood) values ('2026-11-02', 3)`)
    await admin`delete from auth."user" where id = ${temp}`
    const [left] = await admin`select count(*)::int as n from journal_entries where owner_id = ${temp}`
    expect(left!.n).toBe(0)
  })
})

describe("journal actions", () => {
  it("upserts field by field, one line, and removes a day left empty", async () => {
    const first = await as(alice, () => actions.upsert.handler({ day: "2026-11-10", mood: 2 }))
    expect(first.previous).toBeNull()
    expect(first.entry).toMatchObject({ day: "2026-11-10", mood: 2, text: "" })
    const line = await as(alice, () => actions.upsert.handler({ day: "2026-11-10", text: `  Rainy\n  ${marker}  ` }))
    expect(line.entry).toMatchObject({ mood: 2, text: `Rainy ${marker}` })
    expect(line.previous).toEqual({ mood: 2, text: "" })
    const cleared = await as(alice, () => actions.upsert.handler({ day: "2026-11-10", mood: null, text: "" }))
    expect(cleared).toEqual({ day: "2026-11-10", entry: null, previous: { mood: 2, text: `Rainy ${marker}` } })
    expect(await as(alice, () => actions.get.handler({ day: "2026-11-10" }))).toBeNull()
  })

  it("refuses a day that hasn't come yet", async () => {
    await expect(as(alice, () => actions.upsert.handler({ day: "2999-01-01", mood: 3 }))).rejects.toThrow("hasn't come yet")
  })

  it("lists newest first, searches lines and pages by day; ⌘K finds them", async () => {
    await as(alice, () => actions.upsert.handler({ day: "2026-11-05", mood: 5, text: `Great day ${marker}` }))
    const all = await as(alice, () => actions.list.handler({ limit: 10 }))
    expect(all.map((e) => e.day)).toEqual(["2026-11-20", "2026-11-05"])
    expect((await as(alice, () => actions.list.handler({ query: "great DAY", limit: 10 }))).map((e) => e.day)).toEqual(["2026-11-05"])
    expect((await as(alice, () => actions.list.handler({ before: "2026-11-20", limit: 10 }))).map((e) => e.day)).toEqual(["2026-11-05"])
    // A % in the query is a literal, not a wildcard.
    expect(await as(alice, () => actions.list.handler({ query: "%", limit: 10 }))).toEqual([])
    const hits = await as(alice, () => search(marker, 5))
    expect(hits.map((h) => h.href)).toEqual(["/app/journal?day=2026-11-20", "/app/journal?day=2026-11-05"])
    expect(hits[0]).toMatchObject({ title: `Good walk ${marker}`, meta: ["Fri 20 Nov", "2026", "🙂 Good"] })
    // Bob's search never returns Alice's lines.
    expect(await as(bob, () => search("Good walk", 5))).toEqual([])
  })

  it("gives a year for the heat-map and a month's stats", async () => {
    const year = await as(alice, () => actions.year.handler({ year: 2026 }))
    expect(year.days).toEqual([
      { day: "2026-11-05", mood: 5, hasText: true },
      { day: "2026-11-20", mood: 4, hasText: true },
    ])
    const stats = await as(alice, () => actions.stats.handler({ month: "2026-11" }))
    expect(stats).toEqual({
      month: "2026-11",
      written: 2,
      rated: 2,
      averageMood: 4.5,
      best: { day: "2026-11-05", mood: 5, text: `Great day ${marker}` },
      worst: { day: "2026-11-20", mood: 4, text: `Good walk ${marker}` },
    })
    expect((await as(alice, () => actions.stats.handler({ month: "2026-02" }))).written).toBe(0)
  })

  it("deletes a day and returns it for Undo", async () => {
    const deleted = await as(alice, () => actions.delete.handler({ day: "2026-11-05" }))
    expect(deleted).toEqual({ deleted: 1, previous: { mood: 5, text: `Great day ${marker}` } })
    expect(await as(alice, () => actions.delete.handler({ day: "2026-11-05" }))).toEqual({ deleted: 0, previous: null })
    await as(alice, () => actions.upsert.handler({ day: "2026-11-05", ...deleted.previous! }))
  })

  it("reads and saves the evening question setting, on at 21:30 by default", async () => {
    expect(await as(bob, () => actions.settings.handler({}))).toEqual({ promptEnabled: true, promptTime: "21:30" })
    await as(bob, () => actions.updateSettings.handler({ promptEnabled: false, promptTime: "22:15" }))
    expect(await as(bob, () => actions.settings.handler({}))).toEqual({ promptEnabled: false, promptTime: "22:15" })
  })

  it("is the owner's module: other users' monthly report has no journal", async () => {
    expect((await as(alice, () => monthlyReport("2026-11", "Europe/Prague"))).journal).toBeNull()
  })
})

describe("osbot journal API (as the site owner)", () => {
  const P = "/api/internal/osbot/journal"
  let owner = ""
  let createdOwner = false
  let timezone = "Europe/Prague"
  let saved: Record<string, unknown> | undefined
  let today = ""

  beforeAll(async () => {
    const [row] = await admin`select app.site_owner_id() as id`
    if (row?.id) owner = row.id
    else {
      owner = `test-journal-owner-${run}`
      createdOwner = true
      await admin`
        insert into auth."user" (id, name, email, email_verified, role)
        values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
    }
    const [user] = await admin`select timezone from auth."user" where id = ${owner}`
    timezone = user!.timezone
    today = todayIn(timezone)
    ;[saved] = await admin`select * from journal_settings where owner_id = ${owner}`
    await admin`delete from journal_settings where owner_id = ${owner}`
    // Asked a minute ago, the owner's clock: always inside its window.
    const w = wallClock(new Date(Date.now() - 60_000), timezone)
    const time = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`
    await admin`insert into journal_settings (owner_id, prompt_enabled, prompt_time) values (${owner}, true, ${time})`
  })

  afterAll(async () => {
    await admin`delete from journal_settings where owner_id = ${owner}`
    if (saved) await admin`insert into journal_settings ${admin(saved)}`
    await admin`delete from journal_entries where owner_id = ${owner} and text like ${`%${marker}%`}`
    await admin`delete from osbot_deliveries where owner_id = ${owner} and kind = 'journal' and key in (${today}, ${addDaysIso(today, -1)})`
    if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  })

  it("rejects unsigned requests", async () => {
    const response = await routes.journalGET(new Request(`http://127.0.0.1:3303${P}`))
    expect(response.status).toBe(401)
  })

  it("asks once in the evening, and not when the day already has a mood", async () => {
    const due = await call(routes.journalDueGET, "GET", `${P}/due`)
    expect(due.status).toBe(200)
    const date: string = due.json.date
    // Nothing else may have answered the owner's day; the test owns this date.
    await admin`delete from journal_entries where owner_id = ${owner} and day = ${date}`
    await admin`delete from osbot_deliveries where owner_id = ${owner} and kind = 'journal' and key = ${date}`
    const fresh = await call(routes.journalDueGET, "GET", `${P}/due`)
    expect(fresh.json).toMatchObject({ due: true, date, card: { date, entry: null } })
    expect(fresh.json.card.url).toMatch(new RegExp(`/app/journal\\?day=${date}$`))

    expect((await call(routes.journalAckPOST, "POST", `${P}/ack`, { date })).json).toEqual({ acked: 1 })
    expect((await call(routes.journalAckPOST, "POST", `${P}/ack`, { date })).json).toEqual({ acked: 0 })
    expect((await call(routes.journalDueGET, "GET", `${P}/due`)).json.due).toBe(false)

    // Not acked, but the day got a mood (in the app, or by tapping a face): no question.
    await admin`delete from osbot_deliveries where owner_id = ${owner} and kind = 'journal' and key = ${date}`
    await call(routes.journalSavePOST, "POST", `${P}/save`, { date, mood: 3 })
    expect((await call(routes.journalDueGET, "GET", `${P}/due`)).json.due).toBe(false)
    await admin`delete from journal_entries where owner_id = ${owner} and day = ${date}`
  })

  it("saves a face, then the line, and Undo writes the old version back", async () => {
    const mood = await call(routes.journalSavePOST, "POST", `${P}/save`, { date: today, mood: 4 })
    expect(mood.status).toBe(200)
    expect(mood.json).toMatchObject({ date: today, entry: { mood: 4, text: "" }, previous: null })
    expect(mood.json.short).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}$/)
    const line = await call(routes.journalSavePOST, "POST", `${P}/save`, { date: today, text: `From Telegram ${marker}` })
    expect(line.json).toMatchObject({ entry: { mood: 4, text: `From Telegram ${marker}` }, previous: { mood: 4, text: "" } })
    const card = await call(routes.journalGET, "GET", `${P}?date=${today}`)
    expect(card.json.entry).toEqual({ mood: 4, text: `From Telegram ${marker}` })
    const undone = await call(routes.journalSavePOST, "POST", `${P}/save`, { date: today, mood: null, text: "" })
    expect(undone.json.entry).toBeNull()
    expect((await call(routes.journalGET, "GET", P)).json).toMatchObject({ date: today, entry: null })
  })

  it("explains what it won't save", async () => {
    const future = await call(routes.journalSavePOST, "POST", `${P}/save`, { date: "2999-01-01", mood: 3 })
    expect(future.status).toBe(422)
    expect(future.json.message).toMatch(/hasn't come yet/)
    const long = await call(routes.journalSavePOST, "POST", `${P}/save`, { date: today, text: "x".repeat(600) })
    expect(long.status).toBe(422)
    expect(long.json.message).toMatch(/under 500 characters/)
    const bad = await call(routes.journalSavePOST, "POST", `${P}/save`, { date: today, mood: 9 })
    expect(bad.status).toBe(400)
  })

  it("adds the month to the owner's monthly report only when there is something", async () => {
    // A month long ago, so the owner's real entries can't interfere.
    await admin`
      insert into journal_entries (owner_id, day, mood, text) values
        (${owner}, '2001-03-04', 5, ${`Best ${marker}`}),
        (${owner}, '2001-03-09', 2, ${`Hard ${marker}`}),
        (${owner}, '2001-03-20', null, ${`Only a line ${marker}`})`
    const report = await as(owner, () => monthlyReport("2001-03", timezone))
    expect(report.journal).toEqual({
      written: 3,
      rated: 2,
      averageMood: 3.5,
      best: { day: "2001-03-04", mood: 5, text: `Best ${marker}` },
      worst: { day: "2001-03-09", mood: 2, text: `Hard ${marker}` },
      url: `${process.env.BETTER_AUTH_URL!.replace(/\/+$/, "")}/app/journal?year=2001`,
    })
    expect((await as(owner, () => monthlyReport("2001-04", timezone))).journal).toBeNull()
  })

  it("never shows another user's entries to the bot", async () => {
    const card = await call(routes.journalGET, "GET", `${P}?date=2026-11-20`)
    expect(card.json.entry?.text ?? "").not.toContain("Bob's")
  })
})
