// Error log (Ops → Errors): `pnpm test:db`. app.record_error() is the only
// write path (validation, grouping, reopening, the global rate cap, the row
// cap and retention); RLS lets the owner read and resolve their groups and
// nothing else; the bots' report endpoints and the osbot alert flow end to end
// (check → errors, ack, the hourly budget, kind switched off, mute).
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

const SECRET = `osbot-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
const BUDGET_SECRET = `budget-test-${randomBytes(24).toString("hex")}`
process.env.BOT_EXPENSES_API_SECRET = BUDGET_SECRET
// No agent and no certificate checks: only the error log's part of the check matters here.
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3303"
delete process.env.OPS_AGENT_URL

const errorsApi = await import("@/modules/ops/errors-api")
const alertsApi = await import("@/modules/ops/alerts-api")
const { recordError } = await import("@/modules/ops/errors")
const { signedHeaders: signWith } = await import("@/lib/signed-request")
const { BUDGET_BOT_SIGNATURE_HEADERS } = await import("@/modules/budget/bot-api/lib")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-errors-bob-${run}`
let owner = ""
let createdOwner = false
let savedSettings: { disabled_kinds: string[]; muted_until: Date | null } | null = null

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

/** A fingerprint unique to this run. */
const fp = (n: number) => `${run}${String(n).padStart(24, "0")}`

const record = (fingerprint: string, over: Partial<Record<string, string>> = {}) =>
  as(null, (sql) => sql<{ outcome: string }[]>`
    select app.record_error(${over.source ?? "web"}, ${fingerprint}, ${over.name ?? "TypeError"}, ${over.message ?? `boom ${run}`},
      ${over.route ?? "/app/x"}, ${over.method ?? "get"}, ${over.routeType ?? "render"}, ${over.renderSource ?? ""},
      ${over.digest ?? ""}, ${over.stack ?? "TypeError: boom\n    at x (src/x.ts:1)"}) as outcome`).then((r) => r[0]!.outcome)

const row = (fingerprint: string) =>
  admin<Record<string, unknown>[]>`select * from ops_errors where fingerprint = ${fingerprint}`.then((r) => r[0])

beforeAll(async () => {
  const [o] = await admin<{ id: string | null }[]>`select app.site_owner_id() as id`
  if (o?.id) {
    owner = o.id
  } else {
    owner = `test-errors-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`insert into auth."user" (id, name, email, email_verified) values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  const [settings] = await admin`select disabled_kinds, muted_until from ops_alert_settings where owner_id = ${owner}`
  savedSettings = (settings as typeof savedSettings) ?? null
  await admin`delete from ops_alert_settings where owner_id = ${owner}`
  // A clean slate for the alert budget: errors from earlier runs aren't pending.
  await admin`update ops_errors set alert_pending = false, alerted_at = null where owner_id = ${owner}`
  await admin`delete from ops_error_rate`
})

afterAll(async () => {
  await admin`delete from ops_errors where fingerprint like ${`${run}%`} or message like ${`%${run}%`}`
  await admin`delete from ops_error_rate`
  await admin`delete from ops_alert_settings where owner_id = ${owner}`
  if (savedSettings && !createdOwner) {
    await admin`
      insert into ops_alert_settings (owner_id, disabled_kinds, muted_until)
      values (${owner}, ${savedSettings.disabled_kinds}, ${savedSettings.muted_until})`
  }
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("app.record_error", () => {
  it("files a new group under the site owner, then counts it", async () => {
    expect(await record(fp(1))).toBe("new")
    expect(await record(fp(1), { message: `boom again ${run}`, route: "" })).toBe("seen")
    const r = await row(fp(1))
    expect(r).toMatchObject({
      owner_id: owner,
      source: "web",
      count: 2,
      status: "open",
      alert_pending: true,
      message: `boom again ${run}`,
      // No route on the second occurrence: the place stays.
      route: "/app/x",
      method: "GET",
      route_type: "render",
    })
    const hourly = r!.hourly as number[]
    expect(hourly).toHaveLength(24)
    expect(hourly[23]).toBe(2)
  })

  it("reopens a resolved group and asks for an alert again", async () => {
    await record(fp(2))
    await admin`update ops_errors set status = 'resolved', resolved_at = now(), alert_pending = false where fingerprint = ${fp(2)}`
    expect(await record(fp(2))).toBe("reopened")
    expect(await row(fp(2))).toMatchObject({ status: "open", resolved_at: null, alert_pending: true, reopened_count: 1, count: 2 })
  })

  it("slides the hourly series", async () => {
    await record(fp(3))
    await admin`update ops_errors set hourly_at = date_trunc('hour', now()) - interval '3 hours' where fingerprint = ${fp(3)}`
    await record(fp(3))
    const hourly = (await row(fp(3)))!.hourly as number[]
    expect(hourly.slice(19)).toEqual([0, 1, 0, 0, 1])
  })

  it("trims long text instead of failing, and refuses bad source, route type or fingerprint", async () => {
    expect(await record(fp(4), { message: "x".repeat(5000), stack: "s".repeat(9000), name: "N".repeat(300) })).toBe("new")
    const r = await row(fp(4))
    expect((r!.message as string).length).toBe(1000)
    expect((r!.stack as string).length).toBe(6000)
    expect((r!.name as string).length).toBe(120)
    expect(await pgError(record(fp(5), { source: "evil" }))).toBe("22023")
    expect(await pgError(record(fp(5), { routeType: "nope" }))).toBe("22023")
    expect(await pgError(record("not-a-fingerprint"))).toBe("22023")
  })

  it("drops everything past 120 a minute (global), so a storm can't fill the disk", async () => {
    await admin`insert into ops_error_rate (minute, hits) values (date_trunc('minute', now()), 120)
                on conflict (minute) do update set hits = 120`
    expect(await record(fp(6))).toBe("dropped")
    expect(await row(fp(6))).toBeUndefined()
    await admin`delete from ops_error_rate`
    expect(await record(fp(6))).toBe("new")
  })

  it("forgets groups unseen for 90 days (once a minute) and keeps at most 1000", async () => {
    await admin`
      insert into ops_errors (owner_id, fingerprint, source, message, last_seen)
      values (${owner}, ${fp(7)}, 'web', ${`old ${run}`}, now() - interval '91 days')`
    await admin`delete from ops_error_rate`
    await record(fp(8))
    expect(await row(fp(7))).toBeUndefined()

    const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from ops_errors where owner_id = ${owner}`
    const filler = 1000 - n
    await admin`
      insert into ops_errors (owner_id, fingerprint, source, message, status, last_seen)
      select ${owner}, ${run} || lpad(to_hex(1000 + g), 24, '0'), 'web', ${`filler ${run}`},
             case when g < 5 then 'resolved' else 'open' end, now() - (g || ' minutes')::interval
        from generate_series(1, ${filler}) g`
    // The oldest resolved filler is the one that goes.
    const [oldestResolved] = await admin<{ fingerprint: string }[]>`
      select fingerprint from ops_errors where owner_id = ${owner} and status = 'resolved' order by last_seen limit 1`
    expect(await record(fp(9))).toBe("new")
    const [{ n: after }] = await admin<{ n: number }[]>`select count(*)::int as n from ops_errors where owner_id = ${owner}`
    expect(after).toBe(1000)
    expect(await row(oldestResolved!.fingerprint)).toBeUndefined()
    await admin`delete from ops_errors where message = ${`filler ${run}`}`
  })
})

describe("RLS on ops_errors", () => {
  it("lets the owner read and resolve their groups, nothing more", async () => {
    await record(fp(10))
    const seen = await as(owner, (sql) => sql`select id from ops_errors where fingerprint = ${fp(10)}`)
    expect(seen).toHaveLength(1)
    const updated = await as(owner, (sql) => sql`update ops_errors set status = 'resolved', resolved_at = now() where fingerprint = ${fp(10)} returning id`)
    expect(updated).toHaveLength(1)
    // Only the resolve and alert columns are writable.
    expect(await pgError(as(owner, (sql) => sql`update ops_errors set message = 'x' where fingerprint = ${fp(10)}`))).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`delete from ops_errors where fingerprint = ${fp(10)}`))).toBe("42501")
    expect(
      await pgError(as(owner, (sql) => sql`insert into ops_errors (fingerprint, source) values (${fp(11)}, 'web')`)),
    ).toBe("42501")
  })

  it("shows other users and visitors nothing, and keeps the rate table private", async () => {
    expect(await as(bob, (sql) => sql`select id from ops_errors`)).toHaveLength(0)
    expect(await as(null, (sql) => sql`select id from ops_errors`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`update ops_errors set status = 'resolved' returning id`)).toHaveLength(0)
    expect(await pgError(as(owner, (sql) => sql`select * from ops_error_rate`))).toBe("42501")
  })
})

// --- the bots and osbot's alerts, end to end -----------------------------------------

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(handler: (r: Request) => Promise<Response>, path: string, body?: unknown, headersFor = "osbot") {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers =
    headersFor === "osbot"
      ? signedHeaders(SECRET, { method: "POST", path, body: raw })
      : headersFor === "budget"
        ? signWith(BUDGET_SECRET, { method: "POST", path, body: raw }, BUDGET_BOT_SIGNATURE_HEADERS)
        : {}
  const response = await handler(
    new Request(`http://127.0.0.1:3303${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }),
  )
  return { status: response.status, json: (await response.json()) as Json }
}

const check = () => call(alertsApi.opsAlertsCheckPOST, "/api/internal/osbot/ops-alerts/check")
const ackErrors = (ids: string[]) => call(errorsApi.errorAlertsAckPOST, "/api/internal/osbot/ops-alerts/errors/ack", { ids })
const mine = (json: Json) => {
  const items = (json.errors.items as Json[]).filter((e) => String(e.message).includes(run))
  return items.map((e) => `${e.event} ${e.message}`)
}

describe("bots report their own exceptions", () => {
  it("osbot: scrubbed, grouped by its traceback, source osbot", async () => {
    const traceback = `Traceback (most recent call last):
  File "/app/osbot/loops.py", line 40, in every_minute
    await job()
  File "/app/osbot/ops_alerts.py", line 120, in ops_alerts_once
    raise KeyError(key)
KeyError: 'owner@example.com'`
    const body = { name: "KeyError", message: `'owner@example.com' ${run}`, stack: traceback, where: "ops-alerts" }
    const first = await call(errorsApi.errorsReportPOST, "/api/internal/osbot/errors/report", body)
    expect(first).toMatchObject({ status: 200, json: { recorded: true, outcome: "new" } })
    const second = await call(errorsApi.errorsReportPOST, "/api/internal/osbot/errors/report", { ...body, message: `'other@example.com' ${run}` })
    expect(second.json.outcome).toBe("seen")
    const [r] = await admin`select * from ops_errors where source = 'osbot' and message like ${`%${run}%`}`
    expect(r).toMatchObject({ name: "KeyError", route: "ops-alerts", route_type: "bot", count: 2, message: `'<email>' ${run}` })
    expect(r!.stack).toContain("at ops_alerts_once (osbot/ops_alerts.py:120)")
    expect(r!.stack).not.toContain("@example.com")
  })

  it("the expense bot, with its own signature", async () => {
    const body = { name: "ZeroDivisionError", message: `division by zero ${run}`, stack: "", where: "handlers" }
    const res = await call(errorsApi.budgetBotErrorsReportPOST, "/api/internal/budget-bot/errors/report", body, "budget")
    expect(res).toMatchObject({ status: 200, json: { recorded: true } })
    expect(await admin`select 1 from ops_errors where source = 'expense-bot' and message = ${`division by zero ${run}`}`).toHaveLength(1)
    // osbot's signature doesn't open the expense bot's endpoint, and vice versa.
    expect((await call(errorsApi.budgetBotErrorsReportPOST, "/api/internal/budget-bot/errors/report", body, "osbot")).status).toBe(401)
    expect((await call(errorsApi.errorsReportPOST, "/api/internal/osbot/errors/report", body, "none")).status).toBe(401)
  })

  it("the web app's own errors go through the same recorder", async () => {
    const err = Object.assign(new TypeError(`no note for jane@x.com ${run}`), { digest: "424242" })
    expect(await recordError(err, { source: "web", route: "/(private)/app/notes/[id]", method: "GET", routeType: "render" })).toBe("new")
    const [r] = await admin`select * from ops_errors where message = ${`no note for <email> ${run}`}`
    expect(r).toMatchObject({ route: "/app/notes/[id]", digest: "424242", route_type: "render" })
    // Next's control flow is not an error.
    expect(await recordError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/x;307;" }), { source: "web" })).toBeNull()
  })
})

describe("osbot's error alerts", () => {
  beforeEach(async () => {
    await admin`update ops_errors set alert_pending = false, alerted_at = null where owner_id = ${owner}`
    await admin`delete from ops_alert_settings where owner_id = ${owner}`
    await admin`delete from ops_error_rate`
  })

  it("offers each new error once acknowledged, and a reopened one again", async () => {
    await record(fp(20), { message: `first ${run}` })
    const { json } = await check()
    expect(mine(json)).toEqual([`new first ${run}`])
    const item = (json.errors.items as Json[]).find((e) => e.message === `first ${run}`)!
    expect(item).toMatchObject({ name: "TypeError", where: "GET /app/x", count: 1 })

    expect((await ackErrors([item.id])).json).toEqual({ acked: 1 })
    expect(mine((await check()).json)).toEqual([])

    // Resolved from Telegram, then it happens again.
    const resolved = await call(errorsApi.errorsStatusPOST, "/api/internal/osbot/errors/status", { id: item.id, status: "resolved" })
    expect(resolved.json).toEqual({ id: item.id, status: "resolved", previous: "open" })
    await record(fp(20), { message: `first ${run}` })
    expect(mine((await check()).json)).toEqual([`reopened first ${run}`])
  })

  it("sends at most four messages an hour: three singles and one summary, then holds", async () => {
    for (let i = 0; i < 6; i++) await record(fp(30 + i), { message: `burst ${i} ${run}` })
    const { json } = await check()
    expect(json.errors.items).toHaveLength(3)
    expect(json.errors.summary.count).toBe(3)
    for (const e of json.errors.items as Json[]) await ackErrors([e.id])
    await ackErrors(json.errors.summary.ids)

    await record(fp(40), { message: `late ${run}` })
    const later = (await check()).json
    expect(later.errors).toEqual({ items: [], summary: null, held: 1 })
  })

  it("holds them while muted and drops them when the kind is off", async () => {
    await record(fp(50), { message: `muted ${run}` })
    await admin`insert into ops_alert_settings (owner_id, muted_until) values (${owner}, now() + interval '1 hour')`
    expect((await check()).json.errors).toMatchObject({ items: [], summary: null })
    expect((await check()).json.errors.held).toBeGreaterThanOrEqual(1)

    await admin`update ops_alert_settings set muted_until = null, disabled_kinds = array['errors'] where owner_id = ${owner}`
    expect((await check()).json.errors).toEqual({ items: [], summary: null, held: 0 })
    await admin`update ops_alert_settings set disabled_kinds = '{}' where owner_id = ${owner}`
    // Switched back on: what was pending while off isn't replayed.
    expect(mine((await check()).json)).toEqual([])
  })

  it("answers 404 for an error that is gone", async () => {
    const res = await call(errorsApi.errorsStatusPOST, "/api/internal/osbot/errors/status", { id: "00000000-0000-4000-8000-000000000000", status: "resolved" })
    expect(res).toMatchObject({ status: 404, json: { error: "gone" } })
  })
})
