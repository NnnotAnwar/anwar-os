import "server-only"
import { connection } from "next/server"
import { actAs, loadViewer, type Viewer } from "@/core/auth"
import { db, withApiToken } from "@/db"
import { clientIp, consumeRateLimit, type RateRule } from "@/lib/rate-limit"
import { authenticateToken, type AuthenticatedToken } from "./server"
import { bearerToken, canWrite } from "./token"

// The wrapper every Bearer-token route goes through (/api/mcp, /api/v1/*):
//   1. per-address limit, before any lookup;
//   2. `Authorization: Bearer aos_…` → app.authenticate_api_token() (unknown,
//      revoked and expired tokens all get the same 401);
//   3. the route's scope: "write" routes refuse read-only tokens (403);
//   4. per-token limit;
//   5. runs the handler inside actAs(token owner) and withApiToken(), so
//      module actions, asViewer() and RLS see the owner exactly as for a
//      signed-in session, while Postgres knows a token is acting (it can't
//      touch the token table; a read-only token's transactions are read-only).
// Tokens are accepted only by the routes wrapped here: Better Auth (/api/auth)
// and server actions never look at the Authorization header, so a token can't
// reach sign-in settings, token management or anything else.

export const API_RATE_LIMITS = {
  /** Every Bearer request from one address, valid token or not. */
  ip: { window: 60, max: 240 },
  /** Requests per token. An MCP session is a handful of calls per user turn. */
  token: { window: 60, max: 120 },
} as const satisfies Record<string, RateRule>

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
  }
}

export type ApiContext = { request: Request; viewer: Viewer; token: AuthenticatedToken }

export type ApiRouteOptions = {
  /** For log lines. */
  name: string
  /** "write" refuses tokens without the write scope. */
  scope: "read" | "write"
  /** How errors (and only errors) are rendered; JSON by default. */
  renderError?: (request: Request, error: ApiError) => Response
}

export const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const

export function jsonError(_request: Request, error: ApiError): Response {
  return Response.json(
    { error: error.code, message: error.message },
    { status: error.status, headers: { ...noStore, ...error.headers } },
  )
}

const challenge = (error?: string) =>
  ({ "WWW-Authenticate": `Bearer realm="anwar.os"${error ? `, error="${error}"` : ""}` }) as Record<string, string>

/** Same-origin check for browsers: Shortcuts, Claude and curl send no Origin. */
function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false
  const site = process.env.BETTER_AUTH_URL
  try {
    return !site || new URL(origin).origin !== new URL(site).origin
  } catch {
    return true
  }
}

async function limit(key: string, rule: RateRule) {
  const decision = await consumeRateLimit(db, key, rule)
  if (!decision.allowed) {
    throw new ApiError(429, "rate_limited", `Too many requests. Try again in ${decision.retryAfter} seconds.`, {
      "Retry-After": String(decision.retryAfter),
    })
  }
}

/** Authenticates a Bearer request (steps 1–4 above). Throws ApiError. */
export async function authenticateRequest(request: Request, scope: "read" | "write") {
  if (foreignOrigin(request)) throw new ApiError(403, "forbidden_origin", "Requests from other websites are not allowed.")
  await limit(`api-ip:${clientIp(request.headers)}`, API_RATE_LIMITS.ip)

  const raw = bearerToken(request.headers.get("authorization"))
  if (!raw) {
    throw new ApiError(401, "unauthorized", "Send a personal API token: Authorization: Bearer aos_… (Settings → API tokens).", challenge())
  }
  const token = await authenticateToken(raw)
  if (!token) throw new ApiError(401, "invalid_token", "This token is unknown, revoked or expired.", challenge("invalid_token"))
  if (scope === "write" && !canWrite(token.scopes)) {
    throw new ApiError(403, "insufficient_scope", "This token is read-only. Create one with write access.", challenge("insufficient_scope"))
  }
  await limit(`api-token:${token.id}`, API_RATE_LIMITS.token)

  const viewer = await loadViewer(token.userId)
  if (!viewer || viewer.role === "demo") throw new ApiError(401, "invalid_token", "This token is unknown, revoked or expired.", challenge("invalid_token"))
  return { viewer, token }
}

/** Runs `fn` as the token's owner, with Postgres told which token acts. */
export function actAsToken<T>(viewer: Viewer, token: AuthenticatedToken, fn: () => Promise<T>): Promise<T> {
  return actAs(viewer, () => withApiToken({ id: token.id, write: canWrite(token.scopes) }, fn))
}

/** Returns the route handler: authenticate, then run `handler` as the token's owner. */
export function apiRoute({ name, scope, renderError = jsonError }: ApiRouteOptions, handler: (ctx: ApiContext) => Promise<Response>) {
  return async function route(request: Request): Promise<Response> {
    // Always per request (never prerendered at build time).
    await connection()
    try {
      const { viewer, token } = await authenticateRequest(request, scope)
      return await actAsToken(viewer, token, () => handler({ request, viewer, token }))
    } catch (error) {
      if (error instanceof ApiError) return renderError(request, error)
      console.error(`${name}: ${request.method} ${new URL(request.url).pathname} failed`, error)
      return renderError(request, new ApiError(500, "internal", "Something went wrong. Try again in a moment."))
    }
  }
}
