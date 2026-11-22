import "server-only"
import { connection } from "next/server"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { actAs, loadViewer, type Viewer } from "@/core/auth"
import { db } from "@/db"
import { ReplayCache, verifyRequest } from "./signature"

// The wrapper every /api/internal/osbot/* handler goes through:
//   1. off (404) unless OSBOT_API_SECRET is set;
//   2. HMAC signature over timestamp, nonce, method, path + query and body
//      (signature.ts), 60 s window, each signature accepted once;
//   3. resolves the site owner (app.site_owner_id()) and runs the handler inside
//      actAs(owner), so module actions and asViewer() act as the owner and RLS
//      applies as usual. The bot never names a user: it can only ever act as
//      the owner.

const MAX_BODY_BYTES = 64 * 1024
const replay = new ReplayCache()

export type OsbotContext = { owner: Viewer; url: URL; body: unknown }

/** A client error the bot can show as is. */
export class OsbotApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } })

async function siteOwner(): Promise<Viewer | null> {
  const rows = await db.execute<{ id: string | null }>(sql`select app.site_owner_id() as id`)
  const id = rows[0]?.id
  return id ? loadViewer(id) : null
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_BODY_BYTES) return null
  const text = await request.text()
  return Buffer.byteLength(text) > MAX_BODY_BYTES ? null : text
}

/** Parses `input` with `schema`, turning failures into a 400 the bot can log. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new OsbotApiError(400, "invalid_input", `${issue?.path.join(".") || "input"}: ${issue?.message ?? "invalid"}`)
  }
  return parsed.data
}

export function osbotRoute(handler: (ctx: OsbotContext) => Promise<unknown>) {
  return async function route(request: Request): Promise<Response> {
    // Always run per request. With Cache Components a GET handler that returns
    // before touching the request is prerendered at build time, where
    // OSBOT_API_SECRET is unset, which would bake the 404 below into the image.
    await connection()
    const secret = process.env.OSBOT_API_SECRET
    if (!secret) return json({ error: "not_found" }, 404)

    const raw = await readBody(request)
    if (raw === null) return json({ error: "too_large" }, 413)

    const url = new URL(request.url)
    const verdict = verifyRequest({
      secret,
      method: request.method,
      path: url.pathname + url.search,
      body: raw,
      headers: request.headers,
      replay,
    })
    if (!verdict.ok) {
      console.warn(`osbot api: refused ${request.method} ${url.pathname} (${verdict.reason})`)
      return json({ error: "unauthorized" }, 401)
    }

    let body: unknown = undefined
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        return json({ error: "invalid_json" }, 400)
      }
    }

    try {
      const owner = await siteOwner()
      if (!owner) return json({ error: "no_owner", message: "No owner account yet." }, 503)
      const result = await actAs(owner, () => handler({ owner, url, body }))
      return result instanceof Response ? result : json(result ?? { ok: true })
    } catch (error) {
      if (error instanceof OsbotApiError) return json({ error: error.code, message: error.message }, error.status)
      console.error(`osbot api: ${request.method} ${url.pathname} failed`, error)
      return json({ error: "internal" }, 500)
    }
  }
}
