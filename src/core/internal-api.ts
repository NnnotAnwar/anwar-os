import "server-only"
import { connection } from "next/server"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { actAs, loadViewer, type Viewer } from "@/core/auth"
import { db } from "@/db"
import { ReplayCache, verifyRequest, type SignatureHeaderNames } from "@/lib/signed-request"

// The wrapper every internal bot API handler (/api/internal/<bot>/*) goes
// through. One instance per bot, each with its own secret, headers and replay
// cache (osbot: src/modules/osbot/api.ts; the expense bot:
// src/modules/budget/bot-api/api.ts):
//   1. off (404) unless the bot's secret is set;
//   2. HMAC signature over timestamp, nonce, method, path + query and body
//      (src/lib/signed-request.ts), 60 s window, each signature accepted once;
//   3. resolves the site owner (app.site_owner_id()) and runs the handler inside
//      actAs(owner), so module actions and asViewer() act as the owner and RLS
//      applies as usual. A bot never names a user: it can only ever act as
//      the owner.
// Edge Caddy answers /api/internal/* with 404 (infra/edge/sites), so these are
// reachable only from the stack's internal network.

const MAX_BODY_BYTES = 64 * 1024

export type InternalApiContext = { owner: Viewer; url: URL; body: unknown }

/** A client error the bot can show as is. */
export class InternalApiError extends Error {
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

async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > maxBytes) return null
  const text = await request.text()
  return Buffer.byteLength(text) > maxBytes ? null : text
}

/** Parses `input` with `schema`, turning failures into a 400 the bot can log. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new InternalApiError(400, "invalid_input", `${issue?.path.join(".") || "input"}: ${issue?.message ?? "invalid"}`)
  }
  return parsed.data
}

export type InternalApiOptions = {
  /** For log lines: "osbot api: refused GET /…". */
  name: string
  /** Environment variable holding the shared secret; unset = the API answers 404. */
  secretEnv: string
  headers: SignatureHeaderNames
  maxBodyBytes?: number
}

/** Returns the route wrapper for one bot's internal API. */
export function internalApi({ name, secretEnv, headers, maxBodyBytes = MAX_BODY_BYTES }: InternalApiOptions) {
  const replay = new ReplayCache()

  return function internalRoute(handler: (ctx: InternalApiContext) => Promise<unknown>) {
    return async function route(request: Request): Promise<Response> {
      // Always run per request. With Cache Components a GET handler that returns
      // before touching the request is prerendered at build time, where the
      // secret is unset, which would bake the 404 below into the image.
      await connection()
      const secret = process.env[secretEnv]
      if (!secret) return json({ error: "not_found" }, 404)

      const raw = await readBody(request, maxBodyBytes)
      if (raw === null) return json({ error: "too_large" }, 413)

      const url = new URL(request.url)
      const verdict = verifyRequest({
        secret,
        method: request.method,
        path: url.pathname + url.search,
        body: raw,
        headers: request.headers,
        names: headers,
        replay,
      })
      if (!verdict.ok) {
        console.warn(`${name}: refused ${request.method} ${url.pathname} (${verdict.reason})`)
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
        if (error instanceof InternalApiError) return json({ error: error.code, message: error.message }, error.status)
        console.error(`${name}: ${request.method} ${url.pathname} failed`, error)
        return json({ error: "internal" }, 500)
      }
    }
  }
}
