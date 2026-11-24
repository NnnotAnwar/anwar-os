// Personal API tokens end to end against real Postgres: RLS on the token
// table, Bearer auth acting as the token's owner (never anyone else), scopes
// (route-level and Postgres-level read-only), revoked/expired tokens, rate
// limits, and the MCP server driven by the official MCP client.
// `pnpm test:db`. `admin` sets up fixtures; `app` connects as os_app; the
// route handlers use the app's own pool (DATABASE_URL, os_app).
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"

// Route handlers start with `await connection()`; outside Next there is no
// request scope for it (see osbot-api.test.ts).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}))

process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"
const SITE = process.env.BETTER_AUTH_URL

const { actAs, loadViewer } = await import("@/core/auth")
const { withApiToken, withViewer } = await import("@/db")
const { notesNotes } = await import("@/db/schema")
const tokens = await import("@/core/api-tokens/server")
const { hashToken, tokenPrefix } = await import("@/core/api-tokens/token")
const { API_RATE_LIMITS } = await import("@/core/api-tokens/route")
const v1 = await import("@/core/api-v1/routes")
const { mcpRoute } = await import("@/core/mcp/server")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const marker = `apitok-${run}`
// Alice has role owner (every module); Bob is a plain user.
const alice = `test-apitok-alice-${run}`
const bob = `test-apitok-bob-${run}`

function as<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>, tokenId?: string) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
    if (tokenId) await sql`select set_config('app.api_token_id', ${tokenId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function pgError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    // Drizzle wraps the driver's error: the Postgres code is on its cause.
    const error = e as { code?: string; cause?: { code?: string } }
    return error.cause?.code ?? error.code ?? String(e)
  }
  return null
}

/** Creates a token through the real management code, as `userId` with a session. */
async function mint(userId: string, write = false, name = marker) {
  const viewer = (await loadViewer(userId))!
  return actAs(viewer, () => tokens.createApiToken({ name, write, expiry: "30" }))
}

let ip = 0
type Handler = (request: Request) => Promise<Response>

function request(method: string, path: string, init: { token?: string; body?: string; type?: string; headers?: Record<string, string> } = {}) {
  ip += 1
  const headers: Record<string, string> = { "x-forwarded-for": `198.51.100.${ip % 250}`, ...init.headers }
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.type) headers["content-type"] = init.type
  return new Request(`${SITE}${path}`, { method, headers, body: init.body })
}

async function text(handler: Handler, req: Request) {
  const response = await handler(req)
  return { status: response.status, text: await response.text(), headers: response.headers }
}

let aliceRead = { id: "", token: "" }
let aliceWrite = { id: "", token: "" }
let bobWrite = { id: "", token: "" }

beforeAll(async () => {
  await admin`
    insert into auth."user" (id, name, email, email_verified, role, created_at)
    values (${alice}, 'Alice', ${`${alice}@test.local`}, true, 'owner', now() + interval '1 day'),
           (${bob}, 'Bob', ${`${bob}@test.local`}, true, 'user', now())`
  aliceRead = await mint(alice, false)
  aliceWrite = await mint(alice, true)
  bobWrite = await mint(bob, true)
  await admin`insert into notes_notes (owner_id, title, body) values (${alice}, ${`Alice note ${marker}`}, ''), (${bob}, ${`Bob note ${marker}`}, '')`
  const start = new Date()
  start.setUTCMinutes(0, 0, 0)
  await admin`
    insert into calendar_events (owner_id, title, start_at, end_at, all_day)
    values (${alice}, ${`Alice event ${marker}`}, ${start}, ${new Date(start.getTime() + 3_600_000)}, false),
           (${bob}, ${`Bob event ${marker}`}, ${start}, ${new Date(start.getTime() + 3_600_000)}, false)`
})

afterAll(async () => {
  await admin`delete from auth.rate_limit where key like 'api-%'`
  // Cascades every row of theirs (tokens, notes, inbox, budget, events).
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("core_api_tokens: RLS and grants", () => {
  it("each user sees only their own tokens, and never a hash", async () => {
    const mine = await as(alice, (sql) => sql`select id, owner_id from core_api_tokens`)
    expect(mine.length).toBe(2)
    expect(mine.every((r) => r.owner_id === alice)).toBe(true)
    expect(await as(null, (sql) => sql`select id from core_api_tokens`)).toHaveLength(0)
    expect(await pgError(as(alice, (sql) => sql`select token_hash from core_api_tokens`))).toBe("42501")
  })

  it("can't create a token for someone else or delete one", async () => {
    const forBob = as(
      alice,
      (sql) => sql`insert into core_api_tokens (owner_id, name, prefix, token_hash) values (${bob}, 'x', 'aos_AAAAAAAA', ${"0".repeat(64)})`,
    )
    expect(await pgError(forBob)).toBe("42501")
    expect(await pgError(as(alice, (sql) => sql`delete from core_api_tokens where id = ${aliceRead.id}`))).toBe("42501")
    const touched = await as(bob, (sql) => sql`update core_api_tokens set name = 'mine now' where id = ${aliceRead.id} returning id`)
    expect(touched).toHaveLength(0)
  })

  it("refuses everything while a token is acting, even for its owner", async () => {
    expect(await as(alice, (sql) => sql`select id from core_api_tokens`, aliceWrite.id)).toHaveLength(0)
    const insert = as(
      alice,
      (sql) => sql`insert into core_api_tokens (name, prefix, token_hash) values ('x', 'aos_BBBBBBBB', ${"1".repeat(64)})`,
      aliceWrite.id,
    )
    expect(await pgError(insert)).toBe("42501")
    const revoke = await as(alice, (sql) => sql`update core_api_tokens set revoked_at = now() returning id`, aliceWrite.id)
    expect(revoke).toHaveLength(0)
  })

  it("keeps a revoked token revoked", async () => {
    const t = await mint(alice)
    await as(alice, (sql) => sql`update core_api_tokens set revoked_at = now() where id = ${t.id}`)
    expect(await pgError(as(alice, (sql) => sql`update core_api_tokens set revoked_at = null where id = ${t.id}`))).toBe("22023")
  })

  it("authenticate_api_token matches prefix + hash, skips revoked and expired, and marks use", async () => {
    const t = await mint(alice)
    const lookup = (prefix: string, hash: string) =>
      as(null, (sql) => sql`select token_id, user_id, scopes from app.authenticate_api_token(${prefix}, ${hash})`)
    const [row] = await lookup(tokenPrefix(t.token), hashToken(t.token))
    expect(row).toMatchObject({ token_id: t.id, user_id: alice, scopes: ["read"] })
    const [used] = await admin`select last_used_at from core_api_tokens where id = ${t.id}`
    expect(used!.last_used_at).not.toBeNull()

    expect(await lookup(tokenPrefix(t.token), hashToken(`${t.token}x`))).toHaveLength(0)
    expect(await lookup("aos_' or 1=1", hashToken(t.token))).toHaveLength(0)
    await admin`update core_api_tokens set expires_at = now() - interval '1 second' where id = ${t.id}`
    expect(await lookup(tokenPrefix(t.token), hashToken(t.token))).toHaveLength(0)
    await admin`update core_api_tokens set expires_at = null, revoked_at = now() where id = ${t.id}`
    expect(await lookup(tokenPrefix(t.token), hashToken(t.token))).toHaveLength(0)
  })
})

describe("token management", () => {
  it("creates, lists (no secrets) and revokes", async () => {
    const viewer = (await loadViewer(bob))!
    const created = await actAs(viewer, () => tokens.createApiToken({ name: `List ${marker}`, write: false, expiry: "never" }))
    expect(created.token).toMatch(/^aos_[A-Za-z0-9]{48}$/)
    expect(created.expiresAt).toBeNull()
    const listed = await actAs(viewer, () => tokens.listApiTokens())
    const item = listed.find((t) => t.id === created.id)!
    expect(item).toMatchObject({ name: `List ${marker}`, prefix: tokenPrefix(created.token), scopes: ["read"], expired: false })
    expect(JSON.stringify(listed)).not.toContain(created.token)
    expect(listed.every((t) => t.id !== aliceRead.id)).toBe(true)

    expect(await actAs(viewer, () => tokens.revokeApiToken(created.id))).toBe(true)
    expect(await actAs(viewer, () => tokens.revokeApiToken(created.id))).toBe(false)
    expect((await actAs(viewer, () => tokens.listApiTokens())).some((t) => t.id === created.id)).toBe(false)
    // Bob can't revoke Alice's token.
    expect(await actAs(viewer, () => tokens.revokeApiToken(aliceRead.id))).toBe(false)
  })

  it("refuses to manage tokens from inside a token request", async () => {
    const viewer = (await loadViewer(alice))!
    const inside = (fn: () => Promise<unknown>) => actAs(viewer, () => withApiToken({ id: aliceWrite.id, write: true }, fn))
    await expect(inside(() => tokens.createApiToken({ name: "sneaky" }))).rejects.toThrow(/can't manage/)
    await expect(inside(() => tokens.listApiTokens())).rejects.toThrow(/can't manage/)
    await expect(inside(() => tokens.revokeApiToken(aliceRead.id))).rejects.toThrow(/can't manage/)
  })

  it("makes a read-only token's transactions read-only in Postgres", async () => {
    const viewer = (await loadViewer(alice))!
    const write = (token: { id: string; write: boolean }) =>
      actAs(viewer, () =>
        withApiToken(token, () => withViewer(alice, (tx) => tx.insert(notesNotes).values({ title: `RO ${marker}`, body: "" }))),
      )
    expect(await pgError(write({ id: aliceRead.id, write: false }))).toBe("25006")
    expect(await pgError(write({ id: aliceWrite.id, write: true }))).toBeNull()
  })
})

describe("Bearer auth on /api/v1", () => {
  it("GET today answers as the token's owner, in plain text", async () => {
    const res = await text(v1.todayGET, request("GET", "/api/v1/today", { token: aliceRead.token }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/plain")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.text).toContain(`Alice event ${marker}`)
    expect(res.text).not.toContain(`Bob event ${marker}`)

    const json = await v1.todayGET(request("GET", "/api/v1/today?format=json", { token: aliceRead.token }))
    const body = (await json.json()) as { ok: boolean; message: string; today: { events: { title: string }[] } }
    expect(body.ok).toBe(true)
    expect(body.today.events.map((e) => e.title)).toContain(`Alice event ${marker}`)
  })

  it("refuses missing, malformed, unknown, revoked and expired tokens alike", async () => {
    const t = await mint(alice)
    const status = async (token?: string, headers?: Record<string, string>) =>
      (await v1.todayGET(request("GET", "/api/v1/today", { token, headers }))).status

    const missing = await v1.todayGET(request("GET", "/api/v1/today"))
    expect(missing.status).toBe(401)
    expect(missing.headers.get("www-authenticate")).toContain("Bearer")
    expect(await status(undefined, { authorization: `Basic ${t.token}` })).toBe(401)
    expect(await status("aos_not-a-real-token")).toBe(401)
    expect(await status(`${t.token.slice(0, -1)}${t.token.endsWith("A") ? "B" : "A"}`)).toBe(401)
    expect(await status(t.token)).toBe(200)

    await admin`update core_api_tokens set expires_at = now() - interval '1 second' where id = ${t.id}`
    expect(await status(t.token)).toBe(401)
    await admin`update core_api_tokens set expires_at = null where id = ${t.id}`
    expect(await status(t.token)).toBe(200)
    await actAs((await loadViewer(alice))!, () => tokens.revokeApiToken(t.id))
    expect(await status(t.token)).toBe(401)
  })

  it("refuses requests from other websites", async () => {
    const res = await v1.todayGET(request("GET", "/api/v1/today", { token: aliceRead.token, headers: { origin: "https://evil.example" } }))
    expect(res.status).toBe(403)
  })

  it("needs the write scope to capture or add expenses", async () => {
    const capture = await text(v1.capturePOST, request("POST", "/api/v1/capture", { token: aliceRead.token, body: "hello", type: "text/plain" }))
    expect(capture.status).toBe(403)
    expect(capture.text).toContain("read-only")
    const expense = await v1.expensePOST(request("POST", "/api/v1/expense", { token: aliceRead.token, body: "250 coffee", type: "text/plain" }))
    expect(expense.status).toBe(403)
  })

  it("captures into the token owner's inbox (plain text, JSON or a form)", async () => {
    const plain = await text(
      v1.capturePOST,
      request("POST", "/api/v1/capture", { token: aliceWrite.token, body: `Buy milk ${marker}`, type: "text/plain" }),
    )
    expect(plain).toMatchObject({ status: 200, text: "Saved to Inbox.\n" })

    const json = await v1.capturePOST(
      request("POST", "/api/v1/capture", {
        token: bobWrite.token,
        body: JSON.stringify({ text: `Bob thought ${marker}`, kind: "idea" }),
        type: "application/json",
        headers: { accept: "application/json" },
      }),
    )
    expect(json.status).toBe(200)
    expect(await json.json()).toMatchObject({ ok: true, kind: "idea", message: `Saved to Ideas: Bob thought ${marker}.` })

    const form = new URLSearchParams({ text: `Task from form ${marker}`, kind: "task" })
    const task = await text(
      v1.capturePOST,
      request("POST", "/api/v1/capture", { token: aliceWrite.token, body: form.toString(), type: "application/x-www-form-urlencoded" }),
    )
    expect(task.status).toBe(200)
    expect(task.text).toContain("Saved to Tasks:")

    const [inbox] = await admin`select owner_id, source from inbox_items where text = ${`Buy milk ${marker}`}`
    expect(inbox).toMatchObject({ owner_id: alice, source: "api" })
    const [idea] = await admin`select owner_id from ideas_ideas where title = ${`Bob thought ${marker}`}`
    expect(idea!.owner_id).toBe(bob)
    const [taskRow] = await admin`select owner_id from tasks_tasks where title like ${`Task from form ${marker}%`}`
    expect(taskRow!.owner_id).toBe(alice)

    const empty = await text(v1.capturePOST, request("POST", "/api/v1/capture", { token: aliceWrite.token, body: "", type: "text/plain" }))
    expect(empty.status).toBe(400)
    const badKind = await text(
      v1.capturePOST,
      request("POST", "/api/v1/capture", { token: aliceWrite.token, body: JSON.stringify({ text: "x", kind: "ops" }), type: "application/json" }),
    )
    expect(badKind.status).toBe(400)
  })

  it("adds an expense to the owner's Budget from one line", async () => {
    const res = await text(
      v1.expensePOST,
      request("POST", "/api/v1/expense", { token: aliceWrite.token, body: JSON.stringify({ text: `250 ${marker}` }), type: "application/json" }),
    )
    expect(res.status).toBe(200)
    expect(res.text).toMatch(/^Saved CZK 250 for apitok-/)
    expect(res.text).toContain("Spent today: CZK 250.")
    const [row] = await admin`select owner_id, amount_minor from budget_transactions where note = ${marker}`
    expect(row!.owner_id).toBe(alice)
    expect(Number(row!.amount_minor)).toBe(-25000)

    const bad = await text(v1.expensePOST, request("POST", "/api/v1/expense", { token: aliceWrite.token, body: "coffee", type: "text/plain" }))
    expect(bad.status).toBe(400)
    expect(bad.text.trim().length).toBeGreaterThan(0)
  })

  it("rate-limits per token and per address", async () => {
    const t = await mint(alice)
    await admin`
      insert into auth.rate_limit (key, count, window_start) values (${`api-token:${t.id}`}, ${API_RATE_LIMITS.token.max}, now())`
    const limited = await v1.todayGET(request("GET", "/api/v1/today", { token: t.token }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0)
    // Other tokens are unaffected.
    expect((await v1.todayGET(request("GET", "/api/v1/today", { token: aliceRead.token }))).status).toBe(200)

    const address = "203.0.113.77"
    await admin`insert into auth.rate_limit (key, count, window_start) values (${`api-ip:${address}`}, ${API_RATE_LIMITS.ip.max}, now())`
    const fromThere = await v1.todayGET(
      request("GET", "/api/v1/today", { token: aliceRead.token, headers: { "x-forwarded-for": address } }),
    )
    expect(fromThere.status).toBe(429)
  })
})

describe("MCP server at /api/mcp", () => {
  async function connect(token: string, mode: "legacy" | "auto") {
    const client = new Client({ name: "db-test", version: "1.0.0" }, { versionNegotiation: { mode } })
    const transport = new StreamableHTTPClientTransport(new URL(`${SITE}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: (url, init) => mcpRoute(new Request(url, init)),
    })
    await client.connect(transport)
    return client
  }

  const textOf = (result: { content?: unknown }) =>
    ((result.content as { type: string; text?: string }[] | undefined) ?? []).map((c) => c.text ?? "").join("")

  for (const mode of ["legacy", "auto"] as const) {
    it(`serves read tools to a read-only token (${mode} protocol)`, async () => {
      const client = await connect(aliceRead.token, mode)
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain("notes_list")
      expect(names).toContain("tasks_dueToday")
      expect(names).not.toContain("notes_create")
      expect(names.some((n) => n.startsWith("ops_") || n.startsWith("bots_"))).toBe(false)
      expect(names).not.toContain("calendar_getFeed")
      expect(tools.find((t) => t.name === "notes_list")!.annotations?.readOnlyHint).toBe(true)

      const listed = await client.callTool({ name: "notes_list", arguments: {} })
      expect(listed.isError).toBeFalsy()
      expect(textOf(listed)).toContain(`Alice note ${marker}`)
      expect(textOf(listed)).not.toContain(`Bob note ${marker}`)

      const refused = await client.callTool({ name: "notes_create", arguments: { title: "nope" } }).catch((e: Error) => ({
        isError: true,
        content: [{ type: "text", text: e.message }],
      }))
      expect(refused.isError).toBe(true)
      await client.close()
    })
  }

  it("turns every module action into a tool, and no read tool writes", async () => {
    const warn = vi.spyOn(console, "warn")
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const client = await connect(aliceRead.token, "auto")
    const { tools } = await client.listTools()
    expect(warn.mock.calls.filter(([m]) => String(m).startsWith("mcp: skipped"))).toEqual([])
    expect(tools.length).toBeGreaterThan(40)
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object")
    // A read action that wrote would fail with Postgres' read-only error here.
    for (const tool of tools) {
      const result = await client.callTool({ name: tool.name, arguments: {} })
      expect(textOf(result), tool.name).not.toBe("This token is read-only.")
    }
    expect(error.mock.calls.filter(([m]) => String(m).startsWith("mcp:"))).toEqual([])
    warn.mockRestore()
    error.mockRestore()
    await client.close()
  })

  it("lets a write token create entries as its owner", async () => {
    const client = await connect(aliceWrite.token, "auto")
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("notes_create")
    expect(names).toContain("tasks_quickAdd")
    expect(names.some((n) => n.startsWith("ops_"))).toBe(false)

    const created = await client.callTool({ name: "notes_create", arguments: { title: `MCP note ${marker}`, body: "from Claude" } })
    expect(created.isError).toBeFalsy()
    const [row] = await admin`select owner_id from notes_notes where title = ${`MCP note ${marker}`}`
    expect(row!.owner_id).toBe(alice)

    const invalid = await client.callTool({ name: "notes_create", arguments: { title: 42 } })
    expect(invalid.isError).toBe(true)
    await client.close()
  })

  it("answers 401 without a valid token, before any MCP processing", async () => {
    const init = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } },
    })
    const headers = { accept: "application/json, text/event-stream" }
    const none = await mcpRoute(request("POST", "/api/mcp", { body: init, type: "application/json", headers }))
    expect(none.status).toBe(401)
    expect(((await none.json()) as { error: { code: number } }).error.code).toBe(-32001)
    const ok = await mcpRoute(request("POST", "/api/mcp", { token: aliceRead.token, body: init, type: "application/json", headers }))
    expect(ok.status).toBe(200)
  })
})
