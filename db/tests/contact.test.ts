// Contact form: named messages from the public /contact page. `pnpm test:db`.
// Same harness as feedback.test.ts (`admin` sets up fixtures, `app` connects as
// os_app) plus the osbot routes that announce new messages (osbot-api.test.ts).
import { createHash, randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

// Route handlers start with `await connection()`; outside Next there's no request scope.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}))

const SECRET = `contact-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/osbot/routes")
const { alertNewContact } = await import("@/modules/osbot/contact-alerts")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-contact-bob-${run}`
const marker = `contact-${run}`
let owner = ""
let createdOwner = false
const usedHashes: string[] = []

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

/** A fresh sender: its own IP hash, so rate limits never leak between tests. */
function sender() {
  const hash = createHash("sha256").update(randomBytes(16)).digest("hex")
  usedHashes.push(hash)
  return hash
}

const token = () => `test-${run}-${randomBytes(12).toString("hex")}`

type Submission = { topic?: string; name?: string; email?: string; company?: string | null; message?: string }

async function submit(ipHash: string, s: Submission = {}, t = token()) {
  const [row] = await as(
    null,
    (sql) => sql`
      select app.submit_contact(
        ${s.topic ?? "job"},
        ${s.name ?? "Jana"},
        ${s.email ?? "jana@example.com"},
        ${s.company ?? null},
        ${s.message ?? `We are hiring ${marker}`},
        ${ipHash},
        ${t}
      ) as id`,
  )
  return row!.id as string
}

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-contact-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
})

afterAll(async () => {
  await admin`delete from contact_messages where message like ${`%${marker}%`}`
  if (usedHashes.length) await admin`delete from contact_submissions where ip_hash in ${admin(usedHashes)}`
  await admin`delete from osbot_heartbeats where version = ${marker}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("contact_messages access", () => {
  it("cannot be inserted into directly, with or without a viewer", async () => {
    const values = (sql: postgres.TransactionSql) =>
      sql`insert into contact_messages (owner_id, topic, name, email, message)
          values (${owner}, 'job', 'X', 'x@example.com', ${`direct insert ${marker}`})`
    expect(await pgError(as(null, values))).toBe("42501")
    expect(await pgError(as(owner, values))).toBe("42501")
    expect(await pgError(as(bob, values))).toBe("42501")
  })

  it("keeps the rate-limit log out of reach of the app", async () => {
    expect(await pgError(as(null, (sql) => sql`select * from contact_submissions`))).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`delete from contact_submissions`))).toBe("42501")
  })

  it("files a message for the site owner: trimmed, email lower-cased, empty company null", async () => {
    const id = await submit(sender(), { topic: "freelance", name: "  Jana  ", email: " Jana@Example.COM ", company: " " })
    const [row] = await admin`select owner_id, topic, name, email, company, status, alerted_at from contact_messages where id = ${id}`
    expect(row).toEqual({
      owner_id: owner,
      topic: "freelance",
      name: "Jana",
      email: "jana@example.com",
      company: null,
      status: "new",
      alerted_at: null,
    })
  })

  it("is invisible to visitors and to other users", async () => {
    const id = await submit(sender())
    expect(await as(null, (sql) => sql`select id from contact_messages where id = ${id}`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`select id from contact_messages where id = ${id}`)).toHaveLength(0)
    expect(await as(owner, (sql) => sql`select id from contact_messages where id = ${id}`)).toHaveLength(1)
  })

  it("can't be changed or deleted by anyone but the owner", async () => {
    const id = await submit(sender())
    const result = await as(bob, async (sql) => {
      const updated = await sql`update contact_messages set status = 'archived' where id = ${id}`
      const deleted = await sql`delete from contact_messages where id = ${id}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
  })

  it("lets the owner triage, but never rewrite who wrote what", async () => {
    const id = await submit(sender())
    const [row] = await as(owner, (sql) => sql`update contact_messages set status = 'replied' where id = ${id} returning status`)
    expect(row).toEqual({ status: "replied" })
    for (const column of ["message", "email", "name"]) {
      const code = await pgError(as(owner, (sql) => sql`update contact_messages set ${sql(column)} = 'rewritten text' where id = ${id}`))
      expect(code).toBe("42501")
    }
    expect(await pgError(as(owner, (sql) => sql`update contact_messages set owner_id = ${bob} where id = ${id}`))).toBe("42501")
    const deleted = await as(owner, (sql) => sql`delete from contact_messages where id = ${id}`)
    expect(deleted.count).toBe(1)
  })
})

describe("app.submit_contact", () => {
  it("is a security definer with an empty search_path, executable by os_app but not public", async () => {
    const signature = "app.submit_contact(text, text, text, text, text, text, text)"
    const [fn] = await admin`select prosecdef, proconfig from pg_proc where oid = ${signature}::regprocedure`
    expect(fn!.prosecdef).toBe(true)
    expect(fn!.proconfig).toContain('search_path=""')
    const [row] = await admin`
      select has_function_privilege('os_app', ${signature}, 'execute') as app,
             exists (
               select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = ${signature}::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as public`
    expect(row).toEqual({ app: true, public: false })
  })

  it.each([
    ["an unknown topic", { topic: "spam" }],
    ["an empty name", { name: "   " }],
    ["a name over 100 characters", { name: "n".repeat(101) }],
    ["an email without an @", { email: "jana.example.com" }],
    ["an email with spaces", { email: "jana @example.com" }],
    ["a company over 120 characters", { company: "c".repeat(121) }],
    ["a message under 10 characters", { message: "too short" }],
    ["a message over 5000 characters", { message: `${marker}${"x".repeat(5000)}` }],
  ])("rejects %s", async (_, input) => {
    expect(await pgError(submit(sender(), input))).toBe("22023")
  })

  it("rejects a malformed IP hash or a missing token", async () => {
    expect(await pgError(submit("not-a-hash"))).toBe("22023")
    expect(await pgError(submit(sender(), {}, "short"))).toBe("22023")
  })

  it("allows 3 messages per 10 minutes from one sender, saying how long to wait", async () => {
    const ip = sender()
    await submit(ip)
    await submit(ip)
    await submit(ip)
    try {
      await submit(ip)
      expect.unreachable()
    } catch (e) {
      const error = e as { code?: string; detail?: string }
      expect(error.code).toBe("OS429")
      expect(Number(error.detail)).toBeGreaterThan(590)
    }
    await submit(sender())
  })

  it("allows 10 messages per day from one sender", async () => {
    const ip = sender()
    await admin`
      insert into contact_submissions (token, ip_hash, created_at)
      select ${`day-${run}-`} || g, ${ip}, now() - interval '2 hours' from generate_series(1, 10) g`
    expect(await pgError(submit(ip))).toBe("OS430")
  })

  it("refuses a form token that was already used", async () => {
    const t = token()
    await submit(sender(), {}, t)
    expect(await pgError(submit(sender(), {}, t))).toBe("OS409")
  })

  it("deletes the owner's archived messages after 12 months, and nothing else", async () => {
    const old = await submit(sender())
    const recent = await submit(sender())
    const waiting = await submit(sender())
    await admin`update contact_messages set status = 'archived' where id in (${old}, ${recent})`
    await admin`
      alter table contact_messages disable trigger contact_messages_set_updated_at;
    `.simple()
    try {
      await admin`update contact_messages set updated_at = now() - interval '13 months' where id in (${old}, ${waiting})`
    } finally {
      await admin`alter table contact_messages enable trigger contact_messages_set_updated_at`.simple()
    }
    await submit(sender())
    const left = await admin`select id from contact_messages where id in (${old}, ${recent}, ${waiting})`
    expect(left.map((r) => r.id).sort()).toEqual([recent, waiting].sort())
  })
})

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

describe("osbot API: contact alerts and buttons", () => {
  it("lists new messages once, until they are acked", async () => {
    const id = await submit(sender(), { name: "Petr", company: "Studio", message: `A project ${marker}` })
    const listed = await call(routes.contactNewGET, "GET", "/api/internal/osbot/contact/new")
    expect(listed.status).toBe(200)
    const mine = listed.json.items.find((i: { id: string }) => i.id === id)
    expect(mine).toMatchObject({ topic: "job", topicLabel: "Job offer", name: "Petr", company: "Studio", email: "jana@example.com" })
    expect(mine.url).toMatch(new RegExp(`/app/feedback/contact/${id}$`))

    const acked = await call(routes.contactAckPOST, "POST", "/api/internal/osbot/contact/ack", { ids: [id] })
    expect(acked.json).toEqual({ acked: 1 })
    const again = await call(routes.contactAckPOST, "POST", "/api/internal/osbot/contact/ack", { ids: [id] })
    expect(again.json).toEqual({ acked: 0 })
    const after = await call(routes.contactNewGET, "GET", "/api/internal/osbot/contact/new")
    expect(after.json.items.some((i: { id: string }) => i.id === id)).toBe(false)
  })

  it("doesn't announce messages that were already answered or archived in the app", async () => {
    const id = await submit(sender())
    await as(owner, (sql) => sql`update contact_messages set status = 'replied' where id = ${id}`)
    const listed = await call(routes.contactNewGET, "GET", "/api/internal/osbot/contact/new")
    expect(listed.json.items.some((i: { id: string }) => i.id === id)).toBe(false)
  })

  it("sets a message's status and returns the previous one", async () => {
    const path = "/api/internal/osbot/contact/status"
    const id = await submit(sender())
    const replied = await call(routes.contactStatusPOST, "POST", path, { id, status: "replied" })
    expect(replied.json).toEqual({ id, status: "replied", previous: "new" })
    const undo = await call(routes.contactStatusPOST, "POST", path, { id, status: "new" })
    expect(undo.json.previous).toBe("replied")
    expect((await call(routes.contactStatusPOST, "POST", path, { id, status: "spam" })).status).toBe(400)
    const missing = await call(routes.contactStatusPOST, "POST", path, { id: crypto.randomUUID(), status: "archived" })
    expect(missing.status).toBe(404)
  })

  it("leaves the alert to osbot while it's connected, else notifies directly and marks it told", async () => {
    await call(routes.heartbeatPOST, "POST", "/api/internal/osbot/heartbeat", { version: marker, startedAt: new Date().toISOString() })
    const notify = vi.fn(async () => true)
    expect(await alertNewContact(await submit(sender()), "text", { notify })).toBe("osbot")
    expect(notify).not.toHaveBeenCalled()

    await admin`update osbot_heartbeats set last_beat_at = now() - interval '10 minutes' where owner_id = ${owner}`
    const id = await submit(sender())
    expect(await alertNewContact(id, "text", { notify })).toBe("direct")
    expect(notify).toHaveBeenCalledWith("text")
    const [row] = await admin`select alerted_at is not null as told from contact_messages where id = ${id}`
    expect(row).toEqual({ told: true })

    const failing = vi.fn(async () => false)
    expect(await alertNewContact(await submit(sender()), "text", { notify: failing, env: {} })).toBe("none")
  })
})
