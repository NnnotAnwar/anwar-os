import type Anthropic from "@anthropic-ai/sdk"
import type { ToolChip, UiItem } from "./protocol"

// Stored messages ↔ API messages ↔ what the page shows. Pure, unit-tested.
//
// The conversation is replayed append-only and byte-stable: content blocks go
// back exactly as the API returned them (thinking blocks and signatures too),
// so the prompt cache and preserved thinking stay valid. Two request-time
// adjustments never touch stored data: the fallback echo rule and one cache
// breakpoint on the newest block.

export type Block = Anthropic.Beta.Messages.BetaContentBlockParam
export type ApiMessage = Anthropic.Beta.Messages.BetaMessageParam
export type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam
export type ToolUse = { type: "tool_use"; id: string; name: string; input: unknown }

export type MessageKind = "user" | "assistant" | "tool_results"

export type UserMeta = { text?: string; hasImage?: boolean }
export type AssistantMeta = { stopReason?: string | null; model?: string; interrupted?: boolean; notice?: string }
export type ToolResultsMeta = { chips?: ToolChip[]; text?: string; hasImage?: boolean }

export type StoredMessage = {
  id: string
  kind: MessageKind
  content: Block[]
  meta: UserMeta & AssistantMeta & ToolResultsMeta
}

export const roleOf = (kind: MessageKind): "user" | "assistant" => (kind === "assistant" ? "assistant" : "user")

/** Index just after the last `fallback` block (0 when there is none). */
function afterLastFallback(content: readonly { type: string }[]) {
  let at = 0
  content.forEach((b, i) => {
    if (b.type === "fallback") at = i + 1
  })
  return at
}

/**
 * Server-side fallback echo rule: when a model declined mid-answer and another
 * took over, thinking / tool_use blocks before the last `fallback` block are
 * not sent back (the `fallback` block itself stays where it was).
 */
export function echoContent(content: Block[]): Block[] {
  const boundary = afterLastFallback(content)
  if (boundary === 0) return content
  const dropped = new Set(["thinking", "redacted_thinking", "tool_use"])
  return content.filter((b, i) => i >= boundary - 1 || !dropped.has(b.type))
}

/** The tool calls Claude made in an assistant message (only those after a fallback boundary count). */
export function toolUsesOf(content: readonly { type: string }[]): ToolUse[] {
  return content.slice(afterLastFallback(content)).filter((b): b is ToolUse => b.type === "tool_use")
}

/** API messages for the next request, with one cache breakpoint on the newest block. */
export function apiMessages(history: Pick<StoredMessage, "kind" | "content">[]): ApiMessage[] {
  const messages: ApiMessage[] = history.map((m) => ({
    role: roleOf(m.kind),
    content: m.kind === "assistant" ? echoContent(m.content) : m.content,
  }))
  const last = messages.at(-1)
  if (last && Array.isArray(last.content) && last.content.length > 0) {
    const blocks = [...last.content]
    const tail = blocks.at(-1)!
    if (tail.type !== "thinking" && tail.type !== "redacted_thinking") {
      blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } } as Block
      messages[messages.length - 1] = { role: last.role, content: blocks } as ApiMessage
    }
  }
  return messages
}

/**
 * Tool calls left without results (the server stopped mid-turn, the owner hit
 * Stop): the results the next user message must start with, or none.
 */
export function unansweredToolUses(history: Pick<StoredMessage, "kind" | "content">[]): ToolUse[] {
  const last = history.at(-1)
  if (!last || last.kind !== "assistant") return []
  return toolUsesOf(last.content)
}

export function notRun(toolUseId: string, why: string): ToolResult {
  return { type: "tool_result", tool_use_id: toolUseId, content: `Not run: ${why}`, is_error: true }
}

/** The first attached image as a data: URL (for the page), or null. */
export function imageOf(content: readonly Block[]): string | null {
  for (const b of content) {
    if (b.type === "image" && b.source.type === "base64") return `data:${b.source.media_type};base64,${b.source.data}`
  }
  return null
}

/** Text of the API's text blocks. */
export function textOf(content: readonly { type: string }[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
}

/** Stored messages → the chat as the page shows it. */
export function uiItems(history: StoredMessage[]): UiItem[] {
  const items: UiItem[] = []
  for (const m of history) {
    if (m.kind === "assistant") {
      const text = textOf(m.content).trim()
      if (text || m.meta.interrupted) items.push({ type: "assistant", id: m.id, text, interrupted: m.meta.interrupted })
      if (m.meta.notice) items.push({ type: "notice", id: `${m.id}-notice`, tone: "error", text: m.meta.notice })
      continue
    }
    if (m.meta.chips?.length) items.push({ type: "tools", id: `${m.id}-tools`, chips: m.meta.chips })
    if (m.meta.text !== undefined || m.meta.hasImage) {
      const text = m.meta.text ?? ""
      const image = m.meta.hasImage ? imageOf(m.content) : null
      if (text || image) items.push({ type: "user", id: m.id, text, image })
    }
  }
  return items
}

/** A conversation title from its first message: first line, at most 60 characters. */
export function titleFrom(text: string, hasImage: boolean): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? ""
  if (!line) return hasImage ? "Photo" : "New chat"
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line
}
