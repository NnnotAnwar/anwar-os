import "server-only"
import { z } from "zod"
import { publicErrorMessage } from "@/core/api-tokens/errors"
import { ApiError, apiRoute, noStore, type ApiContext } from "@/core/api-tokens/route"
import { hasModule, runModuleAction } from "@/core/module-actions"
import { InternalApiError } from "@/core/internal-api"
import { quickAdd, quickInput } from "@/modules/budget/bot-api/service"
import { capture, captureTargets, splitTitle, type CaptureTarget } from "@/modules/osbot/capture"
import { today } from "@/modules/osbot/service"
import { captureText, expenseText, todayText } from "./format"

// The Shortcuts API (/api/v1/*): three small endpoints for iOS Shortcuts and
// anything else that can send an HTTP request with a header. Same personal API
// tokens as the MCP server (src/core/api-tokens/route.ts). Step-by-step phone
// setup: docs/SHORTCUTS.md.
//
// Answers are plain text by default (a Shortcut can show or speak them as
// they are); send `Accept: application/json` or `?format=json` for JSON.
// Bodies can be JSON, a form (Shortcuts' "Form" option) or plain text.

const MAX_BODY_BYTES = 64 * 1024

function wantsJson(request: Request): boolean {
  const format = new URL(request.url).searchParams.get("format")
  if (format) return format === "json"
  return /\bapplication\/json\b/i.test(request.headers.get("accept") ?? "")
}

function reply(request: Request, text: string, data: Record<string, unknown> = {}, status = 200): Response {
  if (wantsJson(request)) return Response.json({ ok: status < 400, message: text, ...data }, { status, headers: noStore })
  return new Response(`${text}\n`, { status, headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } })
}

function renderError(request: Request, error: ApiError): Response {
  const response = reply(request, error.message, { error: error.code }, error.status)
  for (const [name, value] of Object.entries(error.headers)) response.headers.set(name, value)
  return response
}

/** JSON object, form fields or a plain-text body (as `text`), as strings. */
async function readFields(request: Request): Promise<Record<string, string>> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new ApiError(413, "too_large", "That's too long.")
  const type = request.headers.get("content-type") ?? ""
  if (/multipart\/form-data|application\/x-www-form-urlencoded/i.test(type)) {
    const form = await request.formData().catch(() => null)
    if (!form) throw new ApiError(400, "invalid_body", "Couldn't read the form.")
    return Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string"))
  }
  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new ApiError(413, "too_large", "That's too long.")
  if (/json/i.test(type) || /^\s*\{/.test(raw)) {
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      throw new ApiError(400, "invalid_json", "The body isn't valid JSON.")
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "invalid_body", "Send a JSON object.")
    return Object.fromEntries(
      Object.entries(body).flatMap(([k, v]) => (typeof v === "string" || typeof v === "number" ? [[k, String(v)]] : [])),
    )
  }
  return raw.trim() ? { text: raw } : {}
}

/** Query string fields count too, so a plain GET-style Shortcut URL works for small things. */
async function fields(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams)
  delete query.format
  return { ...query, ...(await readFields(request)) }
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ApiError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the input.")
  return parsed.data
}

/** Module errors meant for the sender become 422s with their message. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof InternalApiError) throw new ApiError(error.status, error.code, error.message)
    const message = publicErrorMessage(error)
    if (message !== null) throw new ApiError(422, "not_saved", message)
    throw error
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/capture { text, kind?: inbox | task | note | link | idea, url? }
// ---------------------------------------------------------------------------

export const captureKinds = ["inbox", "task", "note", "link", "idea"] as const

const captureBody = z
  .object({
    text: z.string().max(20_000, "That's too long to capture in one go.").default(""),
    kind: z
      .string()
      .trim()
      .toLowerCase()
      .default("inbox")
      .transform((k) => k || "inbox")
      .pipe(z.enum(captureKinds, "Kind must be inbox, task, note, link or idea.")),
    url: z.string().trim().max(2100).optional(),
  })
  .refine((b) => b.text.trim() || b.url, "Send some text to save.")

/** osbot's capture targets, except that the inbox records the item as coming from the API. */
const apiTargets: CaptureTarget[] = captureTargets.map((target) =>
  target.kind !== "inbox"
    ? target
    : {
        ...target,
        save: async ({ text, url }) => {
          const item = await runModuleAction<{ id: string; text: string; url: string | null }>("inbox", "capture", {
            text,
            url: url ?? null,
            source: "api",
          })
          return { kind: "inbox", id: item.id, title: splitTitle(item.text || item.url || "", 120).title, url: `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/app/inbox`, duplicate: false }
        },
      },
)

export const capturePOST = apiRoute({ name: "api v1 capture", scope: "write", renderError }, async ({ request }: ApiContext) => {
  const body = parse(captureBody, await fields(request))
  const saved = await guard(() => capture({ kind: body.kind, text: body.text, url: body.url || undefined }, apiTargets))
  return reply(request, captureText(saved), { kind: saved.kind, id: saved.id, title: saved.title, url: saved.url, duplicate: saved.duplicate })
})

// ---------------------------------------------------------------------------
// POST /api/v1/expense { text: "250 coffee" }
// ---------------------------------------------------------------------------

const expenseBody = z.object({
  text: z.string({ error: "Send an amount, e.g. 250 coffee." }).trim().min(1, "Send an amount, e.g. 250 coffee.").max(300),
})

export const expensePOST = apiRoute({ name: "api v1 expense", scope: "write", renderError }, async ({ request, viewer }) => {
  const { text } = parse(expenseBody, await fields(request))
  if (!(await hasModule("budget"))) throw new ApiError(403, "no_budget", "Budget isn't available for this account.")
  // Shortcuts can't pick a category afterwards: save it uncategorised when nothing matches.
  const result = await guard(() => quickAdd(quickInput.parse({ text, requireCategory: false }), viewer.timezone))
  if (result.status !== "created") throw new ApiError(422, "not_saved", "Add a category, e.g. 250 food lunch.")
  return reply(request, expenseText(result.expense, result.totals), { expense: result.expense, totals: result.totals })
})

// ---------------------------------------------------------------------------
// GET /api/v1/today
// ---------------------------------------------------------------------------

export const todayGET = apiRoute({ name: "api v1 today", scope: "read", renderError }, async ({ request, viewer }) => {
  const day = await guard(() => today(viewer.timezone))
  return reply(request, todayText(day), { today: day })
})
