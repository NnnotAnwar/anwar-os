import { describe, expect, it, vi } from "vitest"
import { runTurn, FALLBACK_BETA, type EngineStore, type EngineTools, type Pending, type TurnStart } from "./engine"
import type { ToolInfo } from "./lib/catalog"
import type { Block, StoredMessage } from "./lib/history"
import type { ChatEvent } from "./lib/protocol"

// The agent loop against a scripted stand-in for the Anthropic client: no
// network, no database. Each scripted step is one streamed response.

type Step = { texts?: string[]; content: unknown[]; stop_reason: string }
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function scriptedClient(steps: Step[]) {
  const requests: Record<string, unknown>[] = []
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          // Snapshot: the engine reuses arrays between steps.
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
              for (const t of step.texts ?? []) listeners.forEach((fn) => fn(t))
              return { model: "claude-sonnet-5-5", content: step.content, stop_reason: step.stop_reason, usage }
            },
          }
        },
      },
    },
  }
  return { client: client as never, requests }
}

const tool = (name: string, kind: "read" | "write", destructive = false): ToolInfo => ({
  name,
  module: name.split("_")[0]!,
  action: name.split("_")[1]!,
  kind,
  confirm: kind === "write",
  destructive,
  description: name,
  inputSchema: { type: "object" },
  wrapped: false,
})

function fakeTools() {
  const infos = [tool("tasks_search", "read"), tool("tasks_create", "write"), tool("notes_delete", "write", true)]
  const execute = vi.fn(async (t: ToolInfo, input: unknown) => {
    if (t.name === "tasks_search") return [{ id: "1", title: "Pay rent" }]
    if (t.name === "tasks_create") return { id: "new", title: (input as { title: string }).title }
    return undefined
  })
  const tools: EngineTools = {
    definitions: infos.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
    info: (name) => infos.find((t) => t.name === name),
    validate: (t, input) =>
      t.name === "tasks_create" && typeof (input as { title?: unknown })?.title !== "string" ? { ok: false, error: "title: Required" } : { ok: true, input },
    execute,
    card: async (t, input, id) => ({ id, name: t.name, title: `Card ${t.name}`, details: [{ label: "Input", value: JSON.stringify(input) }], destructive: t.destructive }),
  }
  return { tools, execute }
}

function memoryStore(initial: StoredMessage[] = []) {
  const messages = [...initial]
  let pending: Pending | null = null
  let n = 0
  const store: EngineStore = {
    append: async (kind, content, meta) => {
      const saved = { id: `m${++n}`, kind, content, meta }
      messages.push(saved)
      return saved
    },
    setPending: async (p) => {
      pending = p
    },
    usage: vi.fn(async () => {}),
  }
  return { store, messages, pending: () => pending }
}

const say = (text: string): TurnStart => ({ kind: "message", blocks: [{ type: "text", text }], text, hasImage: false })

async function turn(opts: { steps: Step[]; start: TurnStart; history?: StoredMessage[]; pending?: Pending | null; tools?: ReturnType<typeof fakeTools> }) {
  const { client, requests } = scriptedClient(opts.steps)
  const t = opts.tools ?? fakeTools()
  const mem = memoryStore(opts.history)
  const events: ChatEvent[] = []
  const outcome = await runTurn({
    client,
    model: "claude-sonnet-5-5",
    system: "SYSTEM",
    effort: "low",
    maxTokens: 8192,
    history: opts.history ?? [],
    pending: opts.pending ?? null,
    start: opts.start,
    tools: t.tools,
    store: mem.store,
    emit: (e) => events.push(e),
  })
  return { outcome, events, requests, mem, execute: t.execute }
}

describe("runTurn", () => {
  it("streams a plain answer and stores both messages", async () => {
    const r = await turn({ start: say("hi"), steps: [{ texts: ["Hel", "lo"], content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn" }] })
    expect(r.outcome).toBe("done")
    expect(r.events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ])
    expect(r.mem.messages.map((m) => m.kind)).toEqual(["user", "assistant"])
    // The request: cached system prompt, fallbacks on, effort set, a breakpoint on the newest block.
    const req = r.requests[0]!
    expect(req).toMatchObject({
      model: "claude-sonnet-5-5",
      system: [{ type: "text", text: "SYSTEM", cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    })
    expect((req.messages as { content: Block[] }[])[0]!.content.at(-1)).toMatchObject({ cache_control: { type: "ephemeral" } })
    expect(r.mem.store.usage).toHaveBeenCalledOnce()
  })

  it("runs read tools at once and continues the loop with their results", async () => {
    const r = await turn({
      start: say("what's due?"),
      steps: [
        { content: [{ type: "tool_use", id: "t1", name: "tasks_search", input: { query: "rent" } }], stop_reason: "tool_use" },
        { texts: ["One: Pay rent."], content: [{ type: "text", text: "One: Pay rent." }], stop_reason: "end_turn" },
      ],
    })
    expect(r.outcome).toBe("done")
    expect(r.execute).toHaveBeenCalledOnce()
    expect(r.events[0]).toEqual({ type: "tool", chip: { id: "t1", name: "tasks_search", label: "Searched tasks", summary: "1 found", status: "done" } })
    const results = r.mem.messages[2]!
    expect(results.kind).toBe("tool_results")
    expect(results.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: '[{"id":"1","title":"Pay rent"}]' }])
    expect(r.requests).toHaveLength(2)
  })

  it("never runs a write tool before the owner confirms: the turn pauses with a card", async () => {
    const r = await turn({
      start: say("add a task: call the bank"),
      steps: [
        {
          content: [
            { type: "text", text: "Adding it." },
            { type: "tool_use", id: "s1", name: "tasks_search", input: { query: "bank" } },
            { type: "tool_use", id: "w1", name: "tasks_create", input: { title: "Call the bank" } },
          ],
          stop_reason: "tool_use",
        },
      ],
    })
    expect(r.outcome).toBe("awaiting_confirmation")
    expect(r.execute.mock.calls.map(([t]) => t.name)).toEqual(["tasks_search"])
    expect(r.events.at(-1)).toEqual({
      type: "confirm",
      cards: [{ id: "w1", name: "tasks_create", title: "Card tasks_create", details: [{ label: "Input", value: '{"title":"Call the bank"}' }], destructive: false }],
    })
    const pending = r.mem.pending()!
    expect(pending.calls.map((c) => c.id)).toEqual(["w1"])
    expect(pending.ready.map((x) => x.tool_use_id)).toEqual(["s1"])
    // No tool_results message yet: the read result waits to go back together with the decision.
    expect(r.mem.messages.map((m) => m.kind)).toEqual(["user", "assistant"])
  })

  it("approve runs the write and sends every result of the step in one message", async () => {
    const first = await turn({
      start: say("add"),
      steps: [
        {
          content: [
            { type: "tool_use", id: "s1", name: "tasks_search", input: {} },
            { type: "tool_use", id: "w1", name: "tasks_create", input: { title: "Call the bank" } },
          ],
          stop_reason: "tool_use",
        },
      ],
    })
    const second = await turn({
      history: first.mem.messages,
      pending: first.mem.pending(),
      start: { kind: "decisions", decisions: { w1: "approve" } },
      steps: [{ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }],
    })
    expect(second.outcome).toBe("done")
    expect(second.execute.mock.calls.map(([t, input]) => [t.name, input])).toEqual([["tasks_create", { title: "Call the bank" }]])
    const results = second.mem.messages.find((m) => m.kind === "tool_results")!
    expect(results.content.map((b) => (b as { tool_use_id: string }).tool_use_id)).toEqual(["s1", "w1"])
    expect(results.meta.chips?.map((c) => [c.id, c.status])).toEqual([
      ["s1", "done"],
      ["w1", "approved"],
    ])
    expect(second.mem.pending()).toBeNull()
  })

  it("reject tells Claude nothing changed and runs nothing", async () => {
    const pending: Pending = {
      calls: [{ id: "d1", name: "notes_delete", input: { id: "n1" }, card: { id: "d1", name: "notes_delete", title: "Delete note", details: [], destructive: true } }],
      ready: [],
      chips: [],
    }
    const history: StoredMessage[] = [
      { id: "a", kind: "user", content: [{ type: "text", text: "delete it" }], meta: {} },
      { id: "b", kind: "assistant", content: [{ type: "tool_use", id: "d1", name: "notes_delete", input: { id: "n1" } } as Block], meta: {} },
    ]
    const r = await turn({
      history,
      pending,
      start: { kind: "decisions", decisions: { d1: "reject" } },
      steps: [{ content: [{ type: "text", text: "Kept it." }], stop_reason: "end_turn" }],
    })
    expect(r.execute).not.toHaveBeenCalled()
    const results = r.mem.messages.find((m) => m.kind === "tool_results")!
    expect(results.content).toEqual([{ type: "tool_result", tool_use_id: "d1", content: "The user declined this in the app. Nothing was changed." }])
    expect(r.events[0]).toMatchObject({ type: "tool", chip: { status: "declined" } })
  })

  it("a new message instead of a decision declines the cards inside the same user message", async () => {
    const pending: Pending = {
      calls: [{ id: "w1", name: "tasks_create", input: { title: "x" }, card: { id: "w1", name: "tasks_create", title: "Create task", details: [], destructive: false } }],
      ready: [],
      chips: [],
    }
    const history: StoredMessage[] = [
      { id: "a", kind: "user", content: [{ type: "text", text: "add x" }], meta: {} },
      { id: "b", kind: "assistant", content: [{ type: "tool_use", id: "w1", name: "tasks_create", input: { title: "x" } } as Block], meta: {} },
    ]
    const r = await turn({ history, pending, start: say("actually no"), steps: [{ content: [{ type: "text", text: "OK." }], stop_reason: "end_turn" }] })
    expect(r.execute).not.toHaveBeenCalled()
    const user = r.mem.messages[2]!
    expect(user.kind).toBe("user")
    expect(user.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "w1" })
    expect(user.content.at(-1)).toEqual({ type: "text", text: "actually no" })
  })

  it("rejects invalid tool input without running it", async () => {
    const r = await turn({
      start: say("add"),
      steps: [
        { content: [{ type: "tool_use", id: "w1", name: "tasks_create", input: {} }], stop_reason: "tool_use" },
        { content: [{ type: "text", text: "Need a title." }], stop_reason: "end_turn" },
      ],
    })
    expect(r.execute).not.toHaveBeenCalled()
    expect(r.mem.messages[2]!.content[0]).toMatchObject({ is_error: true, content: '{"INVALID_INPUT":"title: Required"}' })
  })

  it("does not run tools from a reply that was cut off or refused, and closes them", async () => {
    const r = await turn({
      start: say("add"),
      steps: [{ content: [{ type: "tool_use", id: "w1", name: "tasks_create", input: { title: "x" } }], stop_reason: "max_tokens" }],
    })
    expect(r.outcome).toBe("stopped")
    expect(r.execute).not.toHaveBeenCalled()
    expect(r.mem.pending()).toBeNull()
    expect(r.mem.messages.at(-1)!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "w1", is_error: true })
    expect(r.events.at(-1)).toMatchObject({ type: "notice", tone: "error" })
  })

  it("closes tool calls a previous turn left unanswered", async () => {
    const history: StoredMessage[] = [
      { id: "a", kind: "user", content: [{ type: "text", text: "x" }], meta: {} },
      { id: "b", kind: "assistant", content: [{ type: "tool_use", id: "t1", name: "tasks_search", input: {} } as Block], meta: {} },
    ]
    const r = await turn({ history, start: say("hello?"), steps: [{ content: [{ type: "text", text: "Hi." }], stop_reason: "end_turn" }] })
    expect(r.mem.messages[2]!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", is_error: true })
  })

  it("stops after the step limit", async () => {
    const loop = { content: [{ type: "tool_use", id: "t", name: "tasks_search", input: {} }], stop_reason: "tool_use" }
    const { client } = scriptedClient(Array.from({ length: 3 }, (_, i) => ({ ...loop, content: [{ ...loop.content[0], id: `t${i}` }] })))
    const mem = memoryStore()
    const events: ChatEvent[] = []
    const outcome = await runTurn({
      client,
      model: "m",
      system: "s",
      effort: "low",
      maxTokens: 1024,
      history: [],
      pending: null,
      start: say("loop"),
      tools: fakeTools().tools,
      store: mem.store,
      emit: (e) => events.push(e),
      maxSteps: 3,
    })
    expect(outcome).toBe("stopped")
    expect(events.at(-1)).toMatchObject({ type: "notice", text: "Stopped after 3 steps. Ask again to continue." })
  })
})
