import "server-only"
import { connection } from "next/server"
import { z } from "zod"
import { monthlyUsage } from "@/core/ai-usage"
import { actAs, getViewer, type Viewer } from "@/core/auth"
import { modulesFor } from "@/core/module"
import { db } from "@/db"
import { claudeClient, claudeConfig, describeClaudeError } from "@/lib/claude"
import { decodeImage, ImageDataError } from "@/lib/image-data"
import { consumeRateLimit } from "@/lib/rate-limit"
import { modules } from "@/modules/_registry"
import { runTurn, type TurnStart } from "./engine"
import { titleFrom, type Block } from "./lib/history"
import { contextLine, SYSTEM_PROMPT } from "./lib/prompt"
import { MAX_IMAGE_BASE64, MAX_MESSAGE_CHARS, type ChatEvent } from "./lib/protocol"
import { conversationStore, createConversation, getConversation } from "./store"
import { loadTools } from "./tools"

// POST /api/assistant/chat: one chat turn, streamed back as server-sent events
// (lib/protocol.ts). Session-authenticated (the page's own cookie), so it runs
// as the viewer and every tool goes through RLS. The Anthropic key stays here.

const LIMITS = {
  burst: { window: 10 * 60, max: 30 },
  day: { window: 24 * 60 * 60, max: 300 },
}

const body = z
  .object({
    conversationId: z.uuid().optional(),
    text: z.string().max(MAX_MESSAGE_CHARS, "That message is too long.").optional(),
    image: z.string().max(MAX_IMAGE_BASE64, "That photo is too large.").optional(),
    decisions: z.record(z.string().max(100), z.enum(["approve", "reject"])).optional(),
  })
  .refine((b) => b.decisions !== undefined || Boolean(b.text?.trim()) || Boolean(b.image), "Type a message.")

const json = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } })

export async function chatPOST(request: Request): Promise<Response> {
  await connection()
  // The session cookie is SameSite=lax and the body is JSON; also refuse other origins outright.
  const origin = request.headers.get("origin")
  if (origin && URL.canParse(origin) && new URL(origin).host !== (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))) {
    return json(403, "forbidden", "Cross-site request refused.")
  }
  const viewer = await getViewer()
  if (!viewer) return json(401, "unauthorized", "Sign in again.")
  if (!modulesFor(modules, viewer.role).some((mod) => mod.id === "assistant")) return json(403, "forbidden", "The assistant isn't available to you.")
  const config = claudeConfig()
  if (!config.apiKey) return json(503, "ai_disabled", "Add ANTHROPIC_API_KEY on the server to switch the assistant on.")

  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BASE64 + MAX_MESSAGE_CHARS * 4 + 64_000) {
    return json(413, "too_large", "That message is too large.")
  }
  let input: z.infer<typeof body>
  try {
    const parsed = body.safeParse(await request.json())
    if (!parsed.success) return json(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid message.")
    input = parsed.data
  } catch {
    return json(400, "invalid_json", "Invalid message.")
  }

  for (const [name, rule] of Object.entries(LIMITS)) {
    const decision = await consumeRateLimit(db, `assistant-${name}:${viewer.id}`, rule)
    if (!decision.allowed) {
      const minutes = Math.max(1, Math.ceil((decision.retryAfter ?? 60) / 60))
      return json(429, "rate_limited", `That's a lot of messages. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`)
    }
  }

  return actAs(viewer, () => startTurn(request, viewer, input, config))
}

async function startTurn(request: Request, viewer: Viewer, input: z.infer<typeof body>, config: ReturnType<typeof claudeConfig>): Promise<Response> {
  if (config.monthlyLimitUsd !== null) {
    const spent = (await monthlyUsage(viewer.timezone)).costMicroUsd / 1e6
    if (spent >= config.monthlyLimitUsd) {
      return json(402, "monthly_limit", `This month's assistant budget ($${config.monthlyLimitUsd}) is used up. Raise ASSISTANT_MONTHLY_LIMIT_USD to continue.`)
    }
  }

  // The new user message (if any): optional image first, then the time context, then the text.
  let start: TurnStart
  const text = input.text?.trim() ?? ""
  if (input.decisions) {
    start = { kind: "decisions", decisions: input.decisions }
  } else {
    const blocks: Block[] = []
    if (input.image) {
      try {
        const image = decodeImage(input.image)
        blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } })
      } catch (error) {
        return json(400, "bad_image", error instanceof ImageDataError ? error.message : "That photo didn't come through.")
      }
    }
    blocks.push({ type: "text", text: contextLine(new Date(), viewer.timezone) })
    blocks.push({ type: "text", text: text || "(photo)" })
    start = { kind: "message", blocks, text, hasImage: Boolean(input.image) }
  }

  let isNew = false
  let loaded = input.conversationId ? await getConversation(input.conversationId) : null
  if (input.conversationId && !loaded) return json(404, "not_found", "That chat doesn't exist any more.")
  if (!loaded) {
    if (start.kind === "decisions") return json(400, "invalid_input", "Nothing to confirm.")
    const created = await createConversation(titleFrom(text, start.hasImage), config.chatModel)
    loaded = { conversation: created, messages: [] }
    isNew = true
  }
  const { conversation, messages } = loaded
  const tools = await loadTools(viewer.role)
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const emit = (event: ChatEvent) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          open = false // the browser went away; the turn still finishes and is saved
        }
      }
      // Runs inside this request's actAs(viewer) scope: every action sees the viewer.
      void actAs(viewer, async () => {
        if (isNew) emit({ type: "conversation", id: conversation.id, title: conversation.title })
        try {
          await runTurn({
            client: claudeClient(),
            // A conversation keeps the model it started on (thinking blocks and caches are per model).
            model: conversation.model,
            system: SYSTEM_PROMPT,
            effort: config.chatEffort,
            maxTokens: config.maxTokens,
            history: messages,
            pending: conversation.pending,
            start,
            tools,
            store: conversationStore(conversation.id),
            emit,
            signal: request.signal,
          })
        } catch (error) {
          console.error("assistant: turn failed", error)
          emit({ type: "notice", tone: "error", text: describeClaudeError(error) })
        } finally {
          emit({ type: "done" })
          if (open) {
            open = false
            controller.close()
          }
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: no compression layer may buffer the stream.
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
