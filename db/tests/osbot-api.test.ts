// osbot: the internal API route handlers end to end (signature checks, acting
// as the site owner, reminder idempotency) and RLS on the osbot tables.
// `pnpm test:db`. `admin` sets up fixtures, `app` connects as os_app; the route
// handlers use the app's own pool (DATABASE_URL, os_app).
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

const SECRET = `osbot-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/osbot/routes")
const { alertNewFeedback } = await import("@/modules/osbot/feedback-alerts")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-osbot-bob-${run}`
let owner = ""
let createdOwner = false
const marker = `osbot-${run}`

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

function request(method: "GET" | "POST", path: string, body?: unknown, headers?: Record<string, string>) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const signed = headers ?? signedHeaders(SECRET, { method, path, body: raw })
  return new Request(`http://127.0.0.1:3303${path}`, {
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

const minute = 60_000
const startOfMinute = (ms: number) => Math.floor(ms / minute) * minute
let ownerEvent = ""
let bobEvent = ""

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-osbot-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`

  // A dentist appointment 30 minutes from now (on the minute) with a 30-minute
  // reminder, for the owner and for Bob.
  const start = new Date(startOfMinute(Date.now()) + 30 * minute)
  const end = new Date(start.getTime() + 60 * minute)
  for (const who of [owner, bob]) {
    const [event] = await admin`
      insert into calendar_events (owner_id, title, start_at, end_at)
      values (${who}, ${`Dentist ${marker}`}, ${start}, ${end}) returning id`
    await admin`insert into calendar_reminders (owner_id, event_id, minutes_before) values (${who}, ${event!.id}, 30)`
    if (who === owner) ownerEvent = event!.id
    else bobEvent = event!.id
  }
})

afterAll(async () => {
  await admin`delete from notes_notes where title like ${`%${marker}%`}`
  await admin`delete from ideas_ideas where title like ${`%${marker}%`}`
  await admin`delete from links_links where note like ${`%${marker}%`}`
  await admin`delete from calendar_events where id in (${ownerEvent}, ${bobEvent})`
  await admin`delete from feedback_items where message like ${`%${marker}%`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  else await admin`delete from osbot_heartbeats where owner_id = ${owner} and version = ${marker}`
  await Promise.all([admin.end(), app.end()])
})

describe("osbot API: signatures", () => {
  const path = "/api/internal/osbot/today"

  it("accepts a signed request", async () => {
    expect((await call(routes.todayGET, "GET", path)).status).toBe(200)
  })

  it("refuses unsigned, tampered, stale and replayed requests", async () => {
    expect((await routes.todayGET(new Request(`http://127.0.0.1:3303${path}`))).status).toBe(401)

    const forOtherPath = signedHeaders(SECRET, { method: "GET", path: "/api/internal/osbot/feedback/new", body: "" })
    expect((await routes.todayGET(request("GET", path, undefined, forOtherPath))).status).toBe(401)

    const wrongSecret = signedHeaders(`${SECRET}x`, { method: "GET", path, body: "" })
    expect((await routes.todayGET(request("GET", path, undefined, wrongSecret))).status).toBe(401)

    const stale = signedHeaders(SECRET, { method: "GET", path, body: "", timestamp: String(Math.floor(Date.now() / 1000) - 120) })
    expect((await routes.todayGET(request("GET", path, undefined, stale))).status).toBe(401)

    const once = signedHeaders(SECRET, { method: "GET", path, body: "" })
    expect((await routes.todayGET(request("GET", path, undefined, once))).status).toBe(200)
    expect((await routes.todayGET(request("GET", path, undefined, once))).status).toBe(401)
  })

  it("refuses a body that differs from the signed one", async () => {
    const p = "/api/internal/osbot/capture"
    const headers = signedHeaders(SECRET, { method: "POST", path: p, body: JSON.stringify({ kind: "note", text: "a" }) })
    const req = new Request(`http://127.0.0.1:3303${p}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "note", text: `evil ${marker}` }),
    })
    expect((await routes.capturePOST(req)).status).toBe(401)
    expect(await admin`select 1 from notes_notes where title = ${`evil ${marker}`}`).toHaveLength(0)
  })

  it("is switched off without OSBOT_API_SECRET", async () => {
    delete process.env.OSBOT_API_SECRET
    try {
      expect((await call(routes.todayGET, "GET", path)).status).toBe(404)
    } finally {
      process.env.OSBOT_API_SECRET = SECRET
    }
  })
})

describe("osbot API: capture", () => {
  const path = "/api/internal/osbot/capture"

  it("lists destinations with the default first", async () => {
    const { status, json } = await call(routes.captureTargetsGET, "GET", "/api/internal/osbot/capture/targets")
    expect(status).toBe(200)
    expect(json.default).toBe("note")
    expect(json.targets).toEqual([
      { kind: "note", label: "Note", button: "Save as note", needsUrl: false },
      { kind: "link", label: "Link", button: "Save as link", needsUrl: true },
      { kind: "idea", label: "Idea", button: "Save as idea", needsUrl: false },
    ])
  })

  it("saves a note for the site owner, split into title and body", async () => {
    const { status, json } = await call(routes.capturePOST, "POST", path, { kind: "note", text: `Buy milk ${marker}\nand bread` })
    expect(status).toBe(200)
    expect(json).toMatchObject({ kind: "note", title: `Buy milk ${marker}`, duplicate: false })
    const [row] = await admin`select owner_id, body from notes_notes where id = ${json.id}`
    expect(row).toEqual({ owner_id: owner, body: "and bread" })
    // RLS: only the owner sees it.
    expect(await as(bob, (sql) => sql`select id from notes_notes where id = ${json.id}`)).toHaveLength(0)
  })

  it("uses the default destination when no kind is given", async () => {
    const { json } = await call(routes.capturePOST, "POST", path, { text: `Default ${marker}` })
    expect(json.kind).toBe("note")
  })

  it("saves an idea as raw and private", async () => {
    const { json } = await call(routes.capturePOST, "POST", path, { kind: "idea", text: `Bot idea ${marker}` })
    const [row] = await admin`select owner_id, status, is_public from ideas_ideas where id = ${json.id}`
    expect(row).toEqual({ owner_id: owner, status: "raw", is_public: false })
  })

  it("saves a link found in the text, keeping the rest as its note", async () => {
    // .invalid never resolves, so the metadata fetch fails fast and the link is still saved.
    const { status, json } = await call(routes.capturePOST, "POST", path, {
      kind: "link",
      text: `read later https://osbot-${run}.invalid/post ${marker}`,
    })
    expect(status).toBe(200)
    const [row] = await admin`select owner_id, url, note from links_links where id = ${json.id}`
    expect(row).toEqual({ owner_id: owner, url: `https://osbot-${run}.invalid/post`, note: `read later  ${marker}` })
  })

  it("explains what's wrong instead of saving", async () => {
    const noUrl = await call(routes.capturePOST, "POST", path, { kind: "link", text: "no link here" })
    expect(noUrl.status).toBe(422)
    expect(noUrl.json.message).toMatch(/No link found/)
    expect((await call(routes.capturePOST, "POST", path, { kind: "poem", text: "x" })).status).toBe(422)
    expect((await call(routes.capturePOST, "POST", path, { kind: "note", text: "   " })).status).toBe(422)
    expect((await call(routes.capturePOST, "POST", path, { kind: "note", text: 42 })).status).toBe(400)
  })
})

describe("osbot API: reminders", () => {
  const due = "/api/internal/osbot/reminders/due"
  const ack = "/api/internal/osbot/reminders/ack"
  const until = () => `${due}?until=${Date.now()}`

  it("returns only the owner's due reminders", async () => {
    const { status, json } = await call(routes.remindersDueGET, "GET", until())
    expect(status).toBe(200)
    const mine = json.reminders.filter((r: { title: string }) => r.title.endsWith(marker))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ eventId: ownerEvent, minutesBefore: 30 })
    expect(json.reminders.some((r: { eventId: string }) => r.eventId === bobEvent)).toBe(false)
  })

  it("is idempotent: acked reminders are not returned again, repeated acks are no-ops", async () => {
    const { json } = await call(routes.remindersDueGET, "GET", until())
    const keys = json.reminders.find((r: { eventId: string }) => r.eventId === ownerEvent).keys as string[]

    expect((await call(routes.remindersAckPOST, "POST", ack, { keys })).json).toEqual({ acked: 1 })
    expect((await call(routes.remindersAckPOST, "POST", ack, { keys })).json).toEqual({ acked: 0 })

    const again = await call(routes.remindersDueGET, "GET", until())
    expect(again.json.reminders.some((r: { eventId: string }) => r.eventId === ownerEvent)).toBe(false)
  })

  it("ignores keys for events the owner can't see", async () => {
    const start = new Date(startOfMinute(Date.now()) + 30 * minute).toISOString()
    const { json } = await call(routes.remindersAckPOST, "POST", ack, { keys: [`${bobEvent}:${start}:30`, "garbage"] })
    expect(json).toEqual({ acked: 0 })
    expect(await admin`select 1 from calendar_reminder_deliveries where event_id = ${bobEvent}`).toHaveLength(0)
  })

  it("refuses a bad window", async () => {
    expect((await call(routes.remindersDueGET, "GET", `${due}?until=soon`)).status).toBe(400)
    expect((await call(routes.remindersDueGET, "GET", `${due}?lookback=99999`)).status).toBe(400)
  })
})

describe("osbot API: today, heartbeat, feedback", () => {
  it("summarises the owner's day", async () => {
    const { json } = await call(routes.todayGET, "GET", "/api/internal/osbot/today")
    expect(json.timezone).toBeTruthy()
    // The dentist may fall on tomorrow when the test runs just before midnight.
    const titles = json.events.map((e: { title: string }) => e.title)
    expect(titles.filter((t: string) => t === `Dentist ${marker}`).length).toBeLessThanOrEqual(1)
    expect(typeof json.newFeedback).toBe("number")
  })

  it("records the heartbeat for the owner only", async () => {
    const startedAt = new Date().toISOString()
    const { status } = await call(routes.heartbeatPOST, "POST", "/api/internal/osbot/heartbeat", { version: marker, startedAt })
    expect(status).toBe(200)
    const [row] = await admin`select owner_id, version from osbot_heartbeats where owner_id = ${owner}`
    expect(row).toEqual({ owner_id: owner, version: marker })
    expect(await as(bob, (sql) => sql`select 1 from osbot_heartbeats`)).toHaveLength(0)
  })

  it("lists new feedback once, until it is acked", async () => {
    const [item] = await admin`
      insert into feedback_items (owner_id, kind, message, name)
      values (${owner}, 'question', ${`Is the bot working? ${marker}`}, 'Jana') returning id`
    const listed = await call(routes.feedbackNewGET, "GET", "/api/internal/osbot/feedback/new")
    const mine = listed.json.items.find((i: { id: string }) => i.id === item!.id)
    expect(mine).toMatchObject({ kind: "question", kindLabel: "Question", name: "Jana" })
    expect(mine.url).toMatch(new RegExp(`/app/feedback/${item!.id}$`))

    const acked = await call(routes.feedbackAckPOST, "POST", "/api/internal/osbot/feedback/ack", { ids: [item!.id] })
    expect(acked.json).toEqual({ acked: 1 })
    const after = await call(routes.feedbackNewGET, "GET", "/api/internal/osbot/feedback/new")
    expect(after.json.items.some((i: { id: string }) => i.id === item!.id)).toBe(false)
  })
})

describe("feedback alerts: osbot first, direct notify as fallback", () => {
  async function newItem() {
    const [item] = await admin`
      insert into feedback_items (owner_id, kind, message) values (${owner}, 'suggestion', ${`Add dark mode ${marker}`}) returning id`
    return item!.id as string
  }

  it("leaves the alert to osbot while its heartbeat is fresh", async () => {
    await call(routes.heartbeatPOST, "POST", "/api/internal/osbot/heartbeat", { version: marker, startedAt: new Date().toISOString() })
    const notify = vi.fn(async () => true)
    expect(await alertNewFeedback(await newItem(), "text", { notify })).toBe("osbot")
    expect(notify).not.toHaveBeenCalled()
  })

  it("notifies directly when osbot is silent, and records it so the bot won't repeat it", async () => {
    await admin`update osbot_heartbeats set last_beat_at = now() - interval '10 minutes' where owner_id = ${owner}`
    const id = await newItem()
    const notify = vi.fn(async () => true)
    expect(await alertNewFeedback(id, "text", { notify })).toBe("direct")
    expect(notify).toHaveBeenCalledWith("text")
    const [row] = await admin`select channel from osbot_feedback_alerts where feedback_id = ${id}`
    expect(row).toEqual({ channel: "direct" })
  })

  it("notifies directly without touching the database when osbot isn't configured", async () => {
    const notify = vi.fn(async () => false)
    expect(await alertNewFeedback(await newItem(), "text", { notify, env: {} })).toBe("none")
    expect(notify).toHaveBeenCalledOnce()
  })
})

describe("osbot tables: RLS", () => {
  it("hides the owner's reminder deliveries from other users and refuses foreign inserts", async () => {
    expect(await as(bob, (sql) => sql`select 1 from calendar_reminder_deliveries where event_id = ${ownerEvent}`)).toHaveLength(0)
    // Bob can't log a delivery against the owner's event (FK is (owner_id, event_id)).
    const code = await pgError(
      as(bob, (sql) => sql`insert into calendar_reminder_deliveries (event_id, occurrence_start, minutes_before) values (${ownerEvent}, now(), 5)`),
    )
    expect(code).toBe("23503")
  })

  it("only lets a user mark their own feedback as alerted", async () => {
    const [item] = await admin`
      insert into feedback_items (owner_id, kind, message) values (${owner}, 'thanks', ${`Thanks a lot ${marker}`}) returning id`
    const code = await pgError(as(bob, (sql) => sql`insert into osbot_feedback_alerts (feedback_id) values (${item!.id})`))
    expect(code).toBe("42501")
    await as(owner, (sql) => sql`insert into osbot_feedback_alerts (feedback_id, channel) values (${item!.id}, 'direct')`)
    expect(await as(bob, (sql) => sql`select 1 from osbot_feedback_alerts where feedback_id = ${item!.id}`)).toHaveLength(0)
  })

  it("refuses heartbeats written for someone else", async () => {
    const code = await pgError(as(bob, (sql) => sql`insert into osbot_heartbeats (owner_id, started_at) values (${owner}, now())`))
    expect(code).toBe("42501")
  })
})
