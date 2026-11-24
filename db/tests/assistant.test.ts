// The AI assistant: RLS on its tables (assistant_conversations / _messages /
// _usage, db/modules/assistant.sql), the tool catalog built from every real
// module action, and full chat turns through POST /api/assistant/chat with a
// scripted stand-in for the Anthropic client (no network, no key).
// `pnpm test:db`. `admin` sets up fixtures, `app` connects as os_app.
import { randomBytes, randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

const { actAs } = await import("@/core/auth")
const { setClaudeClientForTests } = await import("@/lib/claude")
const { chatPOST } = await import("@/modules/assistant/chat-route")
const { loadTools } = await import("@/modules/assistant/tools")
const { WRITE_ALLOW, DELETE_ALLOW } = await import("@/modules/assistant/lib/catalog")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-assistant-alice-${run}`
const bob = `test-assistant-bob-${run}`

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

const viewer = (id: string) => ({
  id,
  email: `${id}@test.local`,
  role: "owner" as const,
  displayName: "Alice",
  isAnonymous: false,
  twoFactorEnabled: false,
  timezone: "Europe/Prague",
  locale: "en",
})

let aliceChat = ""
let bobChat = ""

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await admin`insert into auth."user" (id, name, email, email_verified) values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
  ;[{ id: aliceChat }] = await as(alice, (sql) => sql<{ id: string }[]>`
    insert into assistant_conversations (title, model) values ('Alice chat', 'claude-sonnet-5-5') returning id`)
  ;[{ id: bobChat }] = await as(bob, (sql) => sql<{ id: string }[]>`
    insert into assistant_conversations (title, model) values ('Bob chat', 'claude-sonnet-5-5') returning id`)
})

afterAll(async () => {
  setClaudeClientForTests(null)
  delete process.env.ANTHROPIC_API_KEY
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

// ---------------------------------------------------------------------------

describe("assistant tables: RLS", () => {
  it("keeps conversations, messages and usage private", async () => {
    await as(alice, (sql) => sql`
      insert into assistant_messages (conversation_id, kind, content) values (${aliceChat}, 'user', '[{"type":"text","text":"hi"}]')`)
    await as(alice, (sql) => sql`
      insert into assistant_usage (conversation_id, kind, model, input_tokens) values (${aliceChat}, 'chat', 'claude-sonnet-5-5', 10)`)
    const bobSees = await as(bob, (sql) => sql`
      select (select count(*)::int from assistant_conversations where owner_id = ${alice}) as chats,
             (select count(*)::int from assistant_messages where owner_id = ${alice}) as messages,
             (select count(*)::int from assistant_usage where owner_id = ${alice}) as usage`)
    expect(bobSees[0]).toEqual({ chats: 0, messages: 0, usage: 0 })
    const anon = await as(null, (sql) => sql`select count(*)::int as n from assistant_conversations`)
    expect(anon[0]!.n).toBe(0)
    const updated = await as(bob, (sql) => sql`update assistant_conversations set title = 'mine' where id = ${aliceChat} returning id`)
    expect(updated).toHaveLength(0)
  })

  it("refuses rows for another owner and messages in another owner's conversation", async () => {
    expect(await pgError(as(alice, (sql) => sql`insert into assistant_conversations (owner_id, title, model) values (${bob}, 'x', 'm')`))).toBe("42501")
    // Bob's conversation id is guessable; the same-owner foreign key still refuses it.
    expect(await pgError(as(alice, (sql) => sql`insert into assistant_messages (conversation_id, kind, content) values (${bobChat}, 'user', '[]')`))).toBe("23503")
    expect(await pgError(as(alice, (sql) => sql`insert into assistant_usage (conversation_id, kind, model) values (${bobChat}, 'chat', 'm')`))).toBe("23503")
  })

  it("keeps messages append-only (only their UI meta changes) and the usage log immutable", async () => {
    expect(await pgError(as(alice, (sql) => sql`update assistant_messages set content = '[]' where conversation_id = ${aliceChat}`))).toBe("42501")
    const meta = await as(alice, (sql) => sql`update assistant_messages set meta = '{"text":"hi"}' where conversation_id = ${aliceChat} returning id`)
    expect(meta).toHaveLength(1)
    expect(await pgError(as(alice, (sql) => sql`delete from assistant_messages where conversation_id = ${aliceChat}`))).toBe("42501")
    expect(await pgError(as(alice, (sql) => sql`update assistant_usage set input_tokens = 0`))).toBe("42501")
    expect(await pgError(as(alice, (sql) => sql`delete from assistant_usage`))).toBe("42501")
  })

  it("deleting a conversation removes its messages and keeps its usage, unlinked", async () => {
    const [chat] = await as(alice, (sql) => sql<{ id: string }[]>`insert into assistant_conversations (title, model) values ('tmp', 'm') returning id`)
    await as(alice, (sql) => sql`insert into assistant_messages (conversation_id, kind, content) values (${chat!.id}, 'user', '[]')`)
    await as(alice, (sql) => sql`insert into assistant_usage (conversation_id, kind, model, output_tokens) values (${chat!.id}, 'chat', 'm', 7)`)
    await as(alice, (sql) => sql`delete from assistant_conversations where id = ${chat!.id}`)
    const [left] = await as(alice, (sql) => sql`
      select (select count(*)::int from assistant_messages where conversation_id = ${chat!.id}) as messages,
             (select count(*)::int from assistant_usage where output_tokens = 7 and conversation_id is null) as usage`)
    expect(left).toEqual({ messages: 0, usage: 1 })
  })
})

// ---------------------------------------------------------------------------

describe("assistant tools from the real module actions", () => {
  it("builds a schema for every offered action and gates every write", async () => {
    const tools = await actAs(viewer(alice), () => loadTools("owner"))
    const names = tools.definitions.map((d) => (d as { name: string }).name)
    expect(names).toEqual([...names].sort())
    expect(names).toEqual(expect.arrayContaining(["tasks_search", "tasks_create", "tasks_complete", "notes_create", "calendar_create", "budget_createTransaction", "search_everything"]))
    expect(names.some((n) => n.startsWith("assistant_"))).toBe(false)
    expect(names).not.toContain("files_downloadUrl")
    expect(names).not.toContain("ops_control")
    for (const def of tools.definitions as { name: string; input_schema: { type: string }; eager_input_streaming?: boolean }[]) {
      expect(def.input_schema.type).toBe("object")
      expect(def.eager_input_streaming).toBe(true)
      const info = tools.info(def.name)!
      if (info.kind === "write") {
        expect(info.confirm).toBe(true)
        expect(WRITE_ALLOW.has(`${info.module}.${info.action}`) || DELETE_ALLOW.has(`${info.module}.${info.action}`)).toBe(true)
      }
    }
    // Every allow-listed write exists in the real modules (a renamed action would silently drop out).
    for (const key of [...WRITE_ALLOW, ...DELETE_ALLOW]) expect(names).toContain(key.replace(".", "_"))
  })
})

// ---------------------------------------------------------------------------

type Step = { content: unknown[]; stop_reason: string }

function scripted(steps: Step[]) {
  const requests: Record<string, unknown>[] = []
  setClaudeClientForTests({
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(JSON.parse(JSON.stringify(params)))
          const step = steps.shift()
          if (!step) throw new Error("no more scripted steps")
          const listeners: ((t: string) => void)[] = []
          return {
            on(event: string, fn: (t: string) => void) {
              if (event === "text") listeners.push(fn)
              return this
            },
            async finalMessage() {
              for (const b of step.content as { type: string; text?: string }[]) if (b.type === "text") listeners.forEach((fn) => fn(b.text!))
              return {
                model: "claude-sonnet-5-5",
                content: step.content,
                stop_reason: step.stop_reason,
                usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
              }
            },
          }
        },
      },
    },
  })
  return requests
}

async function chat(body: Record<string, unknown>) {
  const response = await actAs(viewer(alice), () =>
    chatPOST(
      new Request("http://127.0.0.1:3303/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:3303", host: "127.0.0.1:3303" },
        body: JSON.stringify(body),
      }),
    ),
  )
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) return { status: response.status, events: [], json: await response.json() }
  const text = await response.text()
  const events = text
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice(6)) as { type: string; [k: string]: unknown })
  return { status: response.status, events, json: null }
}

describe("POST /api/assistant/chat", () => {
  it("is off without ANTHROPIC_API_KEY", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const r = await chat({ text: "hi" })
    expect(r.status).toBe(503)
    expect(r.json).toMatchObject({ error: "ai_disabled" })
  })

  it("answers with a read tool, stores the conversation and logs the tokens", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real"
    await as(alice, (sql) => sql`insert into tasks_tasks (title, due_date) values (${`Pay rent ${run}`}, current_date)`)
    const requests = scripted([
      { content: [{ type: "tool_use", id: "toolu_1", name: "tasks_search", input: { query: `rent ${run}` } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "You have **Pay rent** due today." }], stop_reason: "end_turn" },
    ])
    const r = await chat({ text: "Is rent due?" })
    expect(r.status).toBe(200)
    const conversation = r.events.find((e) => e.type === "conversation") as unknown as { id: string; title: string }
    expect(conversation.title).toBe("Is rent due?")
    expect(r.events.find((e) => e.type === "tool")).toMatchObject({ chip: { label: "Searched tasks", summary: "1 found", status: "done" } })
    expect(r.events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("You have **Pay rent** due today.")
    expect(r.events.at(-1)).toEqual({ type: "done" })

    // The tool ran as Alice (RLS) and its result went back to Claude.
    const secondRequest = requests[1] as { messages: { role: string; content: { type: string; content?: string }[] }[]; tools: { name: string }[] }
    expect(secondRequest.messages.at(-1)!.content[0]!.content).toContain(`Pay rent ${run}`)
    // The first user message carries the time context before the text.
    const firstUser = (requests[0] as { messages: { content: { type: string; text: string }[] }[] }).messages[0]!.content
    expect(firstUser[0]!.text).toMatch(/^<context>Now: .* \(Europe\/Prague\)\.<\/context>$/)
    expect(firstUser[1]!.text).toBe("Is rent due?")

    const rows = await as(alice, (sql) => sql`select kind from assistant_messages where conversation_id = ${conversation.id} order by seq`)
    expect(rows.map((x) => x.kind)).toEqual(["user", "assistant", "tool_results", "assistant"])
    const [usage] = await as(alice, (sql) => sql`
      select count(*)::int as n, sum(cache_read_tokens)::int as cached, sum(cost_micro_usd)::int as cost
      from assistant_usage where conversation_id = ${conversation.id}`)
    expect(usage).toEqual({ n: 2, cached: 18000, cost: 2 * (1200 * 2 + 40 * 10 + 9000 * 0.1) })
  })

  it("asks before writing: nothing is created until the confirm card is approved", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real"
    const title = `Call the bank ${run}`
    scripted([{ content: [{ type: "text", text: "Adding it." }, { type: "tool_use", id: "toolu_w", name: "tasks_create", input: { title } }], stop_reason: "tool_use" }])
    const first = await chat({ text: "Add a task: call the bank" })
    const conversationId = (first.events.find((e) => e.type === "conversation") as unknown as { id: string }).id
    expect(first.events.find((e) => e.type === "confirm")).toMatchObject({
      cards: [{ id: "toolu_w", title: "Create task", details: [{ label: "Title", value: title }], destructive: false }],
    })
    const before = await as(alice, (sql) => sql`select count(*)::int as n from tasks_tasks where title = ${title}`)
    expect(before[0]!.n).toBe(0)
    const [pending] = await as(alice, (sql) => sql`select pending from assistant_conversations where id = ${conversationId}`)
    expect(pending!.pending.calls).toHaveLength(1)

    const requests = scripted([{ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }])
    const second = await chat({ conversationId, decisions: { toolu_w: "approve" } })
    expect(second.events.find((e) => e.type === "tool")).toMatchObject({ chip: { label: "Created task", summary: title, status: "approved" } })
    const after = await as(alice, (sql) => sql`select count(*)::int as n from tasks_tasks where title = ${title}`)
    expect(after[0]!.n).toBe(1)
    const lastUser = (requests[0] as { messages: { role: string; content: { type: string; tool_use_id?: string }[] }[] }).messages.at(-1)!
    expect(lastUser.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_w" })
    const [cleared] = await as(alice, (sql) => sql`select pending from assistant_conversations where id = ${conversationId}`)
    expect(cleared!.pending).toBeNull()

    // A stale card (already decided) does nothing and calls nobody.
    scripted([])
    const again = await chat({ conversationId, decisions: { toolu_w: "approve" } })
    expect(again.events.map((e) => e.type)).toEqual(["done"])
  })

  it("never shows one user's chat to another", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real"
    scripted([])
    const r = await chat({ conversationId: bobChat, text: "hi" })
    expect(r.status).toBe(404)
    const r2 = await chat({ conversationId: randomUUID(), decisions: {} })
    expect(r2.status).toBe(404)
  })

  it("refuses cross-site posts", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real"
    const response = await actAs(viewer(alice), () =>
      chatPOST(
        new Request("http://127.0.0.1:3303/api/assistant/chat", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://evil.example", host: "127.0.0.1:3303" },
          body: JSON.stringify({ text: "hi" }),
        }),
      ),
    )
    expect(response.status).toBe(403)
  })
})
