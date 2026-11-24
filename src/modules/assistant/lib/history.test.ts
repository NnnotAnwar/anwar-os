import { describe, expect, it } from "vitest"
import { apiMessages, echoContent, titleFrom, toolUsesOf, uiItems, unansweredToolUses, type Block, type StoredMessage } from "./history"
import { contextLine } from "./prompt"

const thinking = { type: "thinking", thinking: "", signature: "sig" } as Block
const text = (t: string) => ({ type: "text", text: t }) as Block
const use = (id: string) => ({ type: "tool_use", id, name: "tasks_search", input: {} }) as Block
const fallback = { type: "fallback", from: { model: "a" }, to: { model: "b" } } as unknown as Block

describe("echoContent (server-side fallback echo rule)", () => {
  it("leaves ordinary replies byte-identical", () => {
    const content = [thinking, text("hi"), use("t1")]
    expect(echoContent(content)).toBe(content)
  })

  it("drops thinking and tool_use before the last fallback block, keeps the block in place", () => {
    const content = [thinking, text("partial"), use("t0"), fallback, thinking, text("rest"), use("t1")]
    expect(echoContent(content)).toEqual([text("partial"), fallback, thinking, text("rest"), use("t1")])
    expect(toolUsesOf(content).map((u) => u.id)).toEqual(["t1"])
  })
})

describe("apiMessages", () => {
  it("maps kinds to roles and puts one cache breakpoint on the newest block without touching stored data", () => {
    const history = [
      { kind: "user" as const, content: [text("<context/>"), text("hello")] },
      { kind: "assistant" as const, content: [thinking, text("hi"), use("t1")] },
      { kind: "tool_results" as const, content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" } as Block] },
    ]
    const messages = apiMessages(history)
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect((messages[2]!.content as Block[])[0]).toMatchObject({ cache_control: { type: "ephemeral" } })
    expect(history[2]!.content[0]).not.toHaveProperty("cache_control")
    expect((messages[0]!.content as Block[])[1]).not.toHaveProperty("cache_control")
  })

  it("finds tool calls left without results", () => {
    expect(unansweredToolUses([{ kind: "assistant", content: [text("x"), use("t9")] }]).map((u) => u.id)).toEqual(["t9"])
    expect(unansweredToolUses([{ kind: "user", content: [text("x")] }])).toEqual([])
  })
})

describe("uiItems", () => {
  it("shows typed text (not the context line), replies, chips and notices", () => {
    const history: StoredMessage[] = [
      { id: "1", kind: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } } as Block, text("<context/>"), text("what is this?")], meta: { text: "what is this?", hasImage: true } },
      { id: "2", kind: "assistant", content: [thinking, text("Let me look."), use("t1")], meta: {} },
      { id: "3", kind: "tool_results", content: [], meta: { chips: [{ id: "t1", name: "tasks_search", label: "Searched tasks", summary: "2 found", status: "done" }] } },
      { id: "4", kind: "assistant", content: [text("Two tasks.")], meta: { notice: "cut off" } },
    ]
    expect(uiItems(history)).toEqual([
      { type: "user", id: "1", text: "what is this?", image: "data:image/png;base64,AAAA" },
      { type: "assistant", id: "2", text: "Let me look.", interrupted: undefined },
      { type: "tools", id: "3-tools", chips: [expect.objectContaining({ label: "Searched tasks" })] },
      { type: "assistant", id: "4", text: "Two tasks.", interrupted: undefined },
      { type: "notice", id: "4-notice", tone: "error", text: "cut off" },
    ])
  })
})

describe("titles and context", () => {
  it("titles a chat from its first line", () => {
    expect(titleFrom("  \nWhat's on today?\nmore", false)).toBe("What's on today?")
    expect(titleFrom("", true)).toBe("Photo")
    expect(titleFrom("x".repeat(80), false)).toHaveLength(60)
  })

  it("writes the current time in the owner's timezone", () => {
    // Exact punctuation varies with the ICU version; the facts must not.
    const line = contextLine(new Date("2026-11-24T13:05:00Z"), "Europe/Prague")
    expect(line).toMatch(/^<context>Now: Tuesday,? 24 November 2026( at|,) 14:05 \(Europe\/Prague\)\.<\/context>$/)
  })
})
