import "server-only"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getViewer, type Viewer } from "@/core/auth"
import { runModuleAction } from "@/core/module-actions"
import { isOutboxKind, type OutboxKind } from "@/lib/offline/outbox"
import { checkSameOrigin } from "@/lib/same-origin"
import { captureDay } from "@/lib/offline/capture-day"
import { BudgetInputError } from "@/modules/budget/schema"
import { InboxInputError } from "@/modules/inbox/actions"
import { TaskInputError } from "@/modules/tasks/actions"

// POST /api/sync/<kind>: where the offline outbox (src/lib/offline) lands.
// A plain route handler rather than Server Actions, whose ids change with
// every deploy: something captured offline before a deploy is sent after it.
//
//   - the session cookie says who is asking; the item must be theirs (userId);
//   - CSRF: same-origin JSON only (src/lib/same-origin.ts);
//   - each kind runs the owning module's own action through runModuleAction(),
//     so validation, the module's role rules and RLS are the module's;
//   - idempotent: the item's id becomes the new row's id, and the actions
//     return the existing row when they see that id again;
//   - "today" for relative dates ("tomorrow", "yesterday") is the day the item
//     was captured, in the user's timezone, not the day it reached the server.
//
// Answers (src/lib/offline/sync.ts reads them): 200 { ok, value }; 401 signed
// out; 403 cross-origin; 404 unknown kind or module; 409 other_user / conflict;
// 413 too large; 422 { message } refused by the module; 500 try again later.

const MAX_BODY_BYTES = 64 * 1024

const envelope = z.object({
  id: z.uuid(),
  userId: z.string().min(1).max(200),
  capturedAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
})

type Context = { id: string; today: string }

type Handler = (payload: Record<string, unknown>, ctx: Context) => Promise<unknown>

/** What each kind's payload may carry; the module's own input schema does the rest. */
const handlers: Record<OutboxKind, Handler> = {
  inbox: (payload, { id }) => {
    const input = z.object({ text: z.string(), url: z.string().nullish(), source: z.enum(["app", "share"]).optional() }).parse(payload)
    return runModuleAction("inbox", "capture", { ...input, id })
  },
  task: (payload, { id, today }) => {
    const input = z.object({ text: z.string(), listId: z.uuid().nullish(), dueToday: z.boolean().optional() }).parse(payload)
    return runModuleAction("tasks", "quickAdd", { ...input, listId: input.listId ?? null, id, today })
  },
  note: (payload, { id }) => {
    const input = z.object({ title: z.string(), body: z.string() }).parse(payload)
    return runModuleAction("notes", "create", { ...input, id })
  },
  expense: async (payload, { id, today }) => {
    const input = z.object({ text: z.string(), accountId: z.uuid().nullish() }).parse(payload)
    const value = await runModuleAction("budget", "quickAdd", { ...input, accountId: input.accountId ?? null, id, today })
    // Same as Budget's own writes: every budget page and Today's widget read these tables.
    revalidatePath("/app/budget", "layout")
    revalidatePath("/app")
    return value
  },
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } })


/** A message the user can act on, when the module refused the input. */
function refusal(error: unknown): string | null {
  if (error instanceof InboxInputError || error instanceof TaskInputError || error instanceof BudgetInputError) return error.message
  if (error instanceof z.ZodError || (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues))) {
    const issues = (error as { issues: { message?: string }[] }).issues
    return issues[0]?.message || "Check what you wrote and try again."
  }
  return null
}

function pgCode(error: unknown): string | undefined {
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_BODY_BYTES) return { ok: false, response: json({ error: "too_large", message: "That's too long to sync." }, 413) }
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { ok: false, response: json({ error: "too_large", message: "That's too long to sync." }, 413) }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, response: json({ error: "invalid_json", message: "The app sent something unreadable." }, 400) }
  }
}

export async function handleSync(request: Request, kind: string): Promise<Response> {
  const origin = checkSameOrigin(request.headers, request.url, process.env.BETTER_AUTH_URL)
  if (!origin.ok) {
    console.warn(`offline sync: refused POST /api/sync/${kind} (${origin.reason})`)
    return json({ error: "forbidden", message: "Sync only works from the app itself." }, 403)
  }
  if (!isOutboxKind(kind)) return json({ error: "not_found", message: "The app can't sync this kind of item." }, 404)

  const read = await readJson(request)
  if (!read.ok) return read.response
  const parsed = envelope.safeParse(read.body)
  if (!parsed.success) return json({ error: "invalid_input", message: "The app sent an incomplete item." }, 400)
  const { id, userId, capturedAt, payload } = parsed.data

  let viewer: Viewer | null
  try {
    viewer = await getViewer()
  } catch (error) {
    console.error("offline sync: session check failed", error)
    return json({ error: "internal" }, 500)
  }
  if (!viewer) return json({ error: "unauthorized", message: "Sign in to sync." }, 401)
  // Captured on this device under another account: never file it under this one.
  if (viewer.id !== userId) return json({ error: "other_user", message: "Captured while signed in as someone else." }, 409)

  const run = () => handlers[kind](payload, { id, today: captureDay(capturedAt, viewer.timezone) })
  try {
    let value: unknown
    try {
      value = await run()
    } catch (error) {
      // Two sends of the same item raced (two tabs without Web Locks): the
      // other one inserted the row, so this run finds it and returns it.
      if (pgCode(error) !== "23505") throw error
      value = await run()
    }
    return json({ ok: true, value })
  } catch (error) {
    const message = refusal(error)
    if (message) return json({ error: "rejected", message }, 422)
    if (error instanceof Error && /^Module \S+ (is not available|has no action)/.test(error.message)) {
      return json({ error: "not_found", message: "This isn't available to your account." }, 404)
    }
    // The id is taken by a row this user can't see. Never happens with random UUIDs.
    if (pgCode(error) === "23505") return json({ error: "conflict", message: "This clashes with something already saved. Discard it." }, 409)
    console.error(`offline sync: ${kind} ${id} failed`, error)
    return json({ error: "internal", message: "The server couldn't save it. It will try again." }, 500)
  }
}
