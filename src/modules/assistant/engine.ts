import Anthropic from "@anthropic-ai/sdk"
import type { ToolInfo } from "./lib/catalog"
import { chipLabel, chipSummary } from "./lib/describe"
import {
  apiMessages,
  notRun,
  toolUsesOf,
  unansweredToolUses,
  type Block,
  type MessageKind,
  type StoredMessage,
  type ToolResult,
  type ToolUse,
} from "./lib/history"
import type { ChatEvent, ConfirmCard, ToolChip } from "./lib/protocol"

// One chat turn: the agent loop over the Messages API, written by hand (not the
// SDK's tool runner) because a turn can pause for days: a write tool waits for
// the owner's tap on a confirm card, which arrives as a new HTTP request.
//
//   message ─▶ stream reply ─▶ tool calls? ─ reads: run now (as the viewer)
//                    ▲                     └ writes: confirm card, turn ends ("pending")
//                    └──── tool results ◀── decisions (approve / reject) on the next request
//
// Everything outside (database, tools, the API client) is injected, so the loop
// is unit-tested with a scripted client (engine.test.ts). Rules from the API:
// all results of one step go back in ONE user message; a refused or cut-off
// step never runs its tools; stored content is replayed unchanged.

export const FALLBACK_BETA = "server-side-fallback-2026-07-01"
/** Model requests per turn (each tool round trip is one). */
export const MAX_STEPS = 8
/** Characters of one tool result sent back to Claude. */
const MAX_RESULT_CHARS = 24_000

export type PendingCall = { id: string; name: string; input: unknown; card: ConfirmCard }
/** A step's write calls waiting for the owner, plus the results of its read calls (sent together later). */
export type Pending = { calls: PendingCall[]; ready: ToolResult[]; chips: ToolChip[] }

export type EngineTools = {
  definitions: Anthropic.Beta.Messages.BetaToolUnion[]
  info(name: string): ToolInfo | undefined
  validate(tool: ToolInfo, input: unknown): { ok: true; input: unknown } | { ok: false; error: string }
  execute(tool: ToolInfo, input: unknown): Promise<unknown>
  /** The confirm card for a write call (may look up the item it changes). */
  card(tool: ToolInfo, input: unknown, id: string): Promise<ConfirmCard>
}

export type EngineStore = {
  append(kind: MessageKind, content: Block[], meta: StoredMessage["meta"]): Promise<StoredMessage>
  setPending(pending: Pending | null): Promise<void>
  usage(model: string, usage: Anthropic.Beta.Messages.BetaUsage): Promise<void>
}

export type TurnStart =
  | { kind: "message"; blocks: Block[]; text: string; hasImage: boolean }
  | { kind: "decisions"; decisions: Record<string, "approve" | "reject"> }

export type TurnOptions = {
  client: Pick<Anthropic, "beta">
  model: string
  system: string
  effort: "low" | "medium" | "high"
  maxTokens: number
  history: StoredMessage[]
  pending: Pending | null
  start: TurnStart
  tools: EngineTools
  store: EngineStore
  emit: (event: ChatEvent) => void
  signal?: AbortSignal
  maxSteps?: number
}

export type TurnOutcome = "done" | "awaiting_confirmation" | "aborted" | "stopped"

const DECLINED = "The user declined this in the app. Nothing was changed."
const SUPERSEDED = "The user sent a new message instead of confirming. Nothing was changed."

function serialize(result: unknown): string {
  if (result === undefined) return "Done."
  const json = JSON.stringify(result) ?? "null"
  return json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}… [truncated: ${json.length} characters in all; narrow the query]` : json
}

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "The action failed."
}

function chip(tool: ToolInfo | undefined, use: Pick<ToolUse, "id" | "name">, status: ToolChip["status"], summary: string | null): ToolChip {
  return {
    id: use.id,
    name: use.name,
    label: tool ? chipLabel(tool.module, tool.action, tool.kind) : use.name,
    summary,
    status,
  }
}

/** Runs one read call (or an approved write) and returns its result block and chip. */
async function runTool(tools: EngineTools, use: ToolUse, tool: ToolInfo, input: unknown, status: "done" | "approved") {
  try {
    const result = await tools.execute(tool, input)
    return {
      result: { type: "tool_result", tool_use_id: use.id, content: serialize(result) } satisfies ToolResult,
      chip: chip(tool, use, status === "approved" ? "approved" : "done", chipSummary(tool.kind, result)),
    }
  } catch (error) {
    const message = errorText(error)
    return {
      result: { type: "tool_result", tool_use_id: use.id, content: `Error: ${message}`, is_error: true } satisfies ToolResult,
      chip: chip(tool, use, "error", message),
    }
  }
}

export async function runTurn(o: TurnOptions): Promise<TurnOutcome> {
  const { tools, store, emit } = o
  const history = [...o.history]
  const push = async (kind: MessageKind, content: Block[], meta: StoredMessage["meta"]) => {
    const saved = await store.append(kind, content, meta)
    history.push(saved)
    return saved
  }

  // --- 1. Close what the last turn left open, then add this turn's input ----------
  const carried: ToolResult[] = []
  const carriedChips: ToolChip[] = []
  if (o.pending) {
    const decisions = o.start.kind === "decisions" ? o.start.decisions : {}
    carried.push(...o.pending.ready)
    carriedChips.push(...o.pending.chips)
    for (const call of o.pending.calls) {
      const use: ToolUse = { type: "tool_use", id: call.id, name: call.name, input: call.input }
      const tool = tools.info(call.name)
      const approved = o.start.kind === "decisions" && decisions[call.id] === "approve"
      if (approved && tool) {
        const checked = tools.validate(tool, call.input)
        const ran = checked.ok
          ? await runTool(tools, use, tool, checked.input, "approved")
          : { result: notRun(call.id, checked.error), chip: chip(tool, use, "error", checked.error) }
        carried.push(ran.result)
        carriedChips.push(ran.chip)
        emit({ type: "tool", chip: ran.chip })
      } else {
        carried.push({ type: "tool_result", tool_use_id: call.id, content: o.start.kind === "decisions" ? DECLINED : SUPERSEDED })
        const declined = chip(tool, use, "declined", call.card.title)
        carriedChips.push(declined)
        emit({ type: "tool", chip: declined })
      }
    }
    await store.setPending(null)
  } else {
    // A step that ended without its results (server restart, Stop): close it.
    for (const use of unansweredToolUses(history)) carried.push(notRun(use.id, "the reply was interrupted."))
  }

  if (o.start.kind === "message") {
    // Results (if any) first, then the new words, all in one user message.
    await push("user", [...carried, ...o.start.blocks], { text: o.start.text, hasImage: o.start.hasImage, chips: carriedChips })
  } else {
    if (!o.pending) return "done" // nothing to decide (a stale card): no request
    await push("tool_results", carried, { chips: carriedChips })
  }

  // --- 2. The loop ------------------------------------------------------------
  const maxSteps = o.maxSteps ?? MAX_STEPS
  let jsonRetries = 0
  for (let step = 0; step < maxSteps; step++) {
    if (o.signal?.aborted) return "aborted"
    let partial = ""
    let message: Anthropic.Beta.Messages.BetaMessage
    try {
      const stream = o.client.beta.messages.stream(
        {
          model: o.model,
          max_tokens: o.maxTokens,
          system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
          tools: tools.definitions,
          messages: apiMessages(history),
          output_config: { effort: o.effort },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        },
        { signal: o.signal },
      )
      stream.on("text", (delta) => {
        partial += delta
        emit({ type: "text", delta })
      })
      message = await stream.finalMessage()
      jsonRetries = 0
    } catch (error) {
      if (o.signal?.aborted || error instanceof Anthropic.APIUserAbortError) {
        // Keep what was already on screen; thinking and half-made tool calls are dropped.
        if (partial.trim()) await push("assistant", [{ type: "text", text: partial }], { interrupted: true })
        return "aborted"
      }
      if (error instanceof Anthropic.APIError || jsonRetries >= 2) throw error
      // A tool input that couldn't be parsed or a dropped connection: ask again.
      jsonRetries++
      if (partial) emit({ type: "notice", tone: "info", text: "Retrying…" })
      continue
    }

    await store.usage(message.model || o.model, message.usage)
    const content = message.content as unknown as Block[]
    const uses = toolUsesOf(content)

    if (message.stop_reason === "refusal" || (message.stop_reason === "max_tokens" && uses.length > 0)) {
      const notice =
        message.stop_reason === "refusal" ? "Claude declined to continue with this one." : "The reply got too long and was cut off. Ask for less at once."
      await push("assistant", content, { stopReason: message.stop_reason, model: message.model, notice })
      if (uses.length) await push("tool_results", uses.map((u) => notRun(u.id, "the reply was cut off.")), {})
      emit({ type: "notice", tone: "error", text: notice })
      return "stopped"
    }

    await push("assistant", content, { stopReason: message.stop_reason, model: message.model })
    if (uses.length === 0) return "done"

    // --- 3. Tool calls: reads now, writes to the confirm cards ---------------------
    const results: ToolResult[] = []
    const chips: ToolChip[] = []
    const waiting: PendingCall[] = []
    await Promise.all(
      uses.map(async (use) => {
        const tool = tools.info(use.name)
        if (!tool) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: `Error: there is no tool named ${use.name}.`, is_error: true })
          return
        }
        const checked = tools.validate(tool, use.input)
        if (!checked.ok) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ INVALID_INPUT: checked.error }), is_error: true })
          return
        }
        if (tool.confirm) {
          // Stored as Claude sent it (checked again when approved); the card shows no filled-in defaults.
          waiting.push({ id: use.id, name: use.name, input: use.input, card: await tools.card(tool, use.input, use.id) })
          return
        }
        const ran = await runTool(tools, use, tool, checked.input, "done")
        results.push(ran.result)
        chips.push(ran.chip)
        emit({ type: "tool", chip: ran.chip })
      }),
    )
    // Results in the order Claude asked for them.
    const order = new Map(uses.map((u, i) => [u.id, i]))
    results.sort((a, b) => order.get(a.tool_use_id)! - order.get(b.tool_use_id)!)
    waiting.sort((a, b) => order.get(a.id)! - order.get(b.id)!)

    if (waiting.length) {
      await store.setPending({ calls: waiting, ready: results, chips })
      emit({ type: "confirm", cards: waiting.map((w) => w.card) })
      return "awaiting_confirmation"
    }
    await push("tool_results", results, { chips })
  }

  emit({ type: "notice", tone: "info", text: `Stopped after ${maxSteps} steps. Ask again to continue.` })
  return "stopped"
}
