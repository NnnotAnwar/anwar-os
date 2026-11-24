// Server alerts: RLS on ops_alert_state / ops_alert_settings, and osbot's
// /api/internal/osbot/ops-alerts/{check,ack} end to end against a fake
// ops-agent (a local HTTP server answering GET /host and GET /services).
// `pnpm test:db`. `admin` sets up fixtures, `app` connects as os_app; the
// route handlers use the app's own pool (DATABASE_URL, os_app).
import { randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"
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
// No certificate checks: the site isn't HTTPS here and the fake agent lists no sites.
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3303"
process.env.OPS_AGENT_SECRET = randomBytes(32).toString("hex")

const api = await import("@/modules/ops/alerts-api")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-alerts-alice-${run}`
const bob = `test-alerts-bob-${run}`
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

// --- fake ops-agent ---------------------------------------------------------

const GB = 1024 ** 3
let diskPercent = 40
let services: Record<string, unknown>[] = []
const agentPaths: string[] = []

function hostReport() {
  const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
  return {
    time: new Date().toISOString(),
    hostname: "anwar-os",
    uptime_seconds: 3600,
    load: [0.1, 0.1, 0.1],
    memory: { total_bytes: 4 * GB, available_bytes: 3 * GB, used_bytes: GB, swap_total_bytes: 0, swap_used_bytes: 0, psi_some_avg60: 0, psi_full_avg60: 0 },
    disk: { path: "/", total_bytes: 38 * GB, used_bytes: (38 * GB * diskPercent) / 100, available_bytes: (38 * GB * (100 - diskPercent)) / 100, used_percent: diskPercent },
    docker_disk: null,
    reboot: { required: false, packages: [] },
    backup: {
      last: { status: "ok", finished_at: iso(3), offsite: true },
      last_success: { status: "ok", finished_at: iso(3), offsite: true },
    },
    sites: [],
    errors: {},
  }
}

let agent: Server
let agentUrl = ""

beforeAll(async () => {
  agent = createServer((req, res) => {
    agentPaths.push(`${req.method} ${req.url}`)
    if (!req.headers["x-os-signature"]) {
      res.writeHead(401).end()
      return
    }
    res.setHeader("content-type", "application/json")
    if (req.url === "/host") res.end(JSON.stringify({ host: hostReport(), agent: { version: "test" } }))
    else if (req.url?.startsWith("/services")) res.end(JSON.stringify({ services, agent: { version: "test" } }))
    else res.writeHead(404).end(JSON.stringify({ error: "not_found", message: "nope" }))
  })
  await new Promise<void>((resolve) => agent.listen(0, "127.0.0.1", resolve))
  agentUrl = `http://127.0.0.1:${(agent.address() as { port: number }).port}`
  process.env.OPS_AGENT_URL = agentUrl

  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-alerts-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  for (const id of [alice, bob]) {
    await admin`insert into auth."user" (id, name, email, email_verified) values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
  const [settings] = await admin`select disabled_kinds, muted_until from ops_alert_settings where owner_id = ${owner}`
  savedSettings = (settings as typeof savedSettings) ?? null
  await admin`delete from ops_alert_settings where owner_id = ${owner}`
  await admin`delete from ops_alert_state where owner_id = ${owner}`
})

afterAll(async () => {
  agent?.close()
  await admin`delete from ops_alert_state where owner_id = ${owner}`
  await admin`delete from ops_alert_settings where owner_id = ${owner}`
  if (savedSettings && !createdOwner) {
    await admin`
      insert into ops_alert_settings (owner_id, disabled_kinds, muted_until)
      values (${owner}, ${savedSettings.disabled_kinds}, ${savedSettings.muted_until})`
  }
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

// --- the osbot API ----------------------------------------------------------

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(handler: (r: Request) => Promise<Response>, path: string, body?: unknown, signed = true) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers = signed ? signedHeaders(SECRET, { method: "POST", path, body: raw }) : {}
  const response = await handler(
    new Request(`http://127.0.0.1:3303${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }),
  )
  return { status: response.status, json: (await response.json()) as Json }
}

const check = () => call(api.opsAlertsCheckPOST, "/api/internal/osbot/ops-alerts/check")
const ack = (items: { key: string; event: string }[]) => call(api.opsAlertsAckPOST, "/api/internal/osbot/ops-alerts/ack", { items })
const events = (json: Json) => (json.notifications as Json[]).map((n) => `${n.event} ${n.key}`)

const crashingBot = {
  name: "bot-osbot",
  container: "anwar-os-bot-osbot-1",
  image: "ghcr.io/nnnotanwar/anwar-os-bot-osbot",
  tag: "abc1234",
  state: "restarting",
  health: "none",
  exit_code: 1,
  restart_count: 4,
  protected: false,
  cpu_percent: null,
  mem_bytes: null,
  mem_limit_bytes: null,
}

describe("ops alerts API", () => {
  beforeEach(() => {
    process.env.OPS_AGENT_URL = agentUrl
  })

  it("refuses unsigned requests", async () => {
    expect((await call(api.opsAlertsCheckPOST, "/api/internal/osbot/ops-alerts/check", undefined, false)).status).toBe(401)
    expect((await call(api.opsAlertsAckPOST, "/api/internal/osbot/ops-alerts/ack", { items: [] }, false)).status).toBe(401)
  })

  it("is quiet while everything is fine", async () => {
    diskPercent = 40
    services = []
    const { status, json } = await check()
    expect(status).toBe(200)
    expect(json).toMatchObject({ firing: [], notifications: [], mutedUntil: null })
    expect(agentPaths).toContain("GET /host")
    expect(agentPaths).toContain("GET /services?stats=0")
  })

  it("announces each new problem once, until it is acknowledged", async () => {
    diskPercent = 91
    services = [crashingBot]
    const first = await check()
    expect(events(first.json)).toEqual(["firing container:bot-osbot", "firing disk"])
    expect(first.json.notifications[0]).toMatchObject({ kind: "container", title: "bot-osbot keeps restarting", detail: "4 restarts · image tag abc1234." })
    expect(first.json.notifications[1]).toMatchObject({ kind: "disk", title: "Disk 91 % full" })

    // Not acknowledged (the bot crashed before sending): offered again.
    expect(events((await check()).json)).toEqual(["firing container:bot-osbot", "firing disk"])

    const acked = await ack([
      { key: "disk", event: "firing" },
      { key: "container:bot-osbot", event: "firing" },
    ])
    expect(acked.json).toEqual({ acked: 2 })
    const again = await check()
    expect(again.json.notifications).toEqual([])
    expect((again.json.firing as Json[]).map((f) => f.key).sort()).toEqual(["container:bot-osbot", "disk"])
  })

  it("sends the recovery once and then forgets the problem", async () => {
    diskPercent = 50
    const { json } = await check()
    expect(events(json)).toEqual(["resolved disk"])
    expect(json.notifications[0]).toMatchObject({ title: "Disk 91 % full" })
    // A stale ack (the event doesn't match the state) changes nothing.
    expect((await ack([{ key: "disk", event: "firing" }])).json).toEqual({ acked: 0 })
    expect((await ack([{ key: "disk", event: "resolved" }])).json).toEqual({ acked: 1 })
    expect((await check()).json.notifications).toEqual([])
    expect(await admin`select 1 from ops_alert_state where owner_id = ${owner} and key = 'disk'`).toHaveLength(0)
  })

  it("holds alerts while muted and sends what is still wrong afterwards", async () => {
    await admin`
      insert into ops_alert_settings (owner_id, muted_until) values (${owner}, now() + interval '1 hour')
      on conflict (owner_id) do update set muted_until = excluded.muted_until`
    diskPercent = 95
    const muted = await check()
    expect(muted.json.notifications).toEqual([])
    expect(muted.json.mutedUntil).not.toBeNull()
    expect((muted.json.firing as Json[]).map((f) => f.key)).toContain("disk")

    await admin`update ops_alert_settings set muted_until = now() - interval '1 minute' where owner_id = ${owner}`
    const after = await check()
    expect(events(after.json)).toEqual(["firing disk"])
    await ack([{ key: "disk", event: "firing" }])
  })

  it("doesn't track kinds that are switched off, and announces them again when switched back on", async () => {
    await admin`update ops_alert_settings set disabled_kinds = '{container}' where owner_id = ${owner}`
    const off = await check()
    expect((off.json.firing as Json[]).map((f) => f.key)).toEqual(["disk"])
    expect(off.json.notifications).toEqual([])
    expect(await admin`select 1 from ops_alert_state where owner_id = ${owner} and kind = 'container'`).toHaveLength(0)

    await admin`update ops_alert_settings set disabled_kinds = '{}' where owner_id = ${owner}`
    expect(events((await check()).json)).toEqual(["firing container:bot-osbot"])
    await ack([{ key: "container:bot-osbot", event: "firing" }])
  })

  it("raises one 'agent' alert when ops-agent stops answering, and resolves the rest", async () => {
    process.env.OPS_AGENT_URL = "http://127.0.0.1:9" // discard port: refused
    const { json } = await check()
    expect(events(json)).toEqual(["firing agent", "resolved container:bot-osbot", "resolved disk"])
    expect(json.notifications[0]).toMatchObject({ kind: "agent", title: "ops-agent is unreachable" })
  })

  it("validates acks", async () => {
    expect((await ack([{ key: "Bad Key!", event: "firing" }])).status).toBe(400)
    expect((await ack([{ key: "disk", event: "maybe" }])).status).toBe(400)
  })
})

// --- RLS ----------------------------------------------------------------------

describe("ops_alert_state / ops_alert_settings RLS", () => {
  it("keeps each user's alerts and settings to themselves", async () => {
    await as(alice, (sql) => sql`insert into ops_alert_state (key, kind, title) values ('disk', 'disk', 'Disk 90 % full')`)
    await as(alice, (sql) => sql`insert into ops_alert_settings (disabled_kinds) values ('{reboot}')`)
    expect(await as(bob, (sql) => sql`select 1 from ops_alert_state where owner_id = ${alice}`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`select 1 from ops_alert_settings where owner_id = ${alice}`)).toHaveLength(0)
    expect(await as(null, (sql) => sql`select 1 from ops_alert_state`)).toHaveLength(0)
    expect((await as(bob, (sql) => sql`update ops_alert_state set firing = false where owner_id = ${alice}`)).count).toBe(0)
    expect((await as(bob, (sql) => sql`delete from ops_alert_state where owner_id = ${alice}`)).count).toBe(0)
    expect((await as(bob, (sql) => sql`update ops_alert_settings set muted_until = now() where owner_id = ${alice}`)).count).toBe(0)
  })

  it("refuses rows for someone else", async () => {
    expect(
      await pgError(as(bob, (sql) => sql`insert into ops_alert_state (owner_id, key, kind, title) values (${alice}, 'x', 'disk', 'x')`)),
    ).toBe("42501")
    expect(await pgError(as(bob, (sql) => sql`insert into ops_alert_settings (owner_id) values (${alice})`))).toBe("42501")
  })

  it("checks keys, kinds and lengths", async () => {
    expect(await pgError(as(alice, (sql) => sql`insert into ops_alert_state (key, kind, title) values ('Disk', 'disk', 'x')`))).toBe("23514")
    expect(await pgError(as(alice, (sql) => sql`insert into ops_alert_state (key, kind, title) values ('x', 'weather', 'x')`))).toBe("23514")
    expect(await pgError(as(alice, (sql) => sql`insert into ops_alert_state (key, kind, title) values ('y', 'disk', '')`))).toBe("23514")
    expect(await pgError(as(alice, (sql) => sql`update ops_alert_settings set disabled_kinds = '{weather}'`))).toBe("23514")
  })

  it("has no delete on settings: they go with the user", async () => {
    expect(await pgError(as(alice, (sql) => sql`delete from ops_alert_settings`))).toBe("42501")
  })
})
