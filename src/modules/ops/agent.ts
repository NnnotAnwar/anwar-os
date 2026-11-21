import "server-only"
import type { Offline } from "./schema"
import { signedHeaders } from "./lib/sign"

// The one place web talks to ops-agent (services/ops-agent). Every request is
// HMAC-signed over method, path and body; the agent is reachable on the
// internal network only. Unset OPS_AGENT_URL (dev) = "not connected", never a crash.

export type AgentResult<T> = { ok: true; status: number; data: T } | ({ ok: false; status?: number } & Offline)

function config() {
  const url = process.env.OPS_AGENT_URL?.replace(/\/+$/, "")
  const secret = process.env.OPS_AGENT_SECRET
  return url && secret && secret.length >= 32 ? { url, secret } : null
}

export function agentConfigured() {
  return config() !== null
}

/**
 * Calls the agent. Non-2xx answers with a JSON body (refusals, failed deploys)
 * still come back as data with their status, so callers can show the reason.
 */
export async function agentRequest<T>(
  method: "GET" | "POST",
  path: `/${string}`,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<AgentResult<T>> {
  const cfg = config()
  if (!cfg) return { ok: false, reason: "not_configured" }
  const raw = body === undefined ? "" : JSON.stringify(body)
  let res: Response
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers: {
        ...signedHeaders(cfg.secret, method, path, raw),
        ...(raw ? { "Content-Type": "application/json" } : {}),
      },
      body: raw || undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
    return { ok: false, reason: "unreachable", message: timedOut ? "The agent didn't answer in time." : "Can't reach the agent." }
  }
  if (res.status === 401) return { ok: false, status: 401, reason: "unauthorized" }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, status: res.status, reason: "error", message: `The agent answered ${res.status} without details.` }
  }
  return { ok: true, status: res.status, data: data as T }
}

/** The agent's error body: { error: code, message }. */
export type AgentError = { error: string; message: string }

export function isAgentError(v: unknown): v is AgentError {
  return typeof v === "object" && v !== null && "error" in v && typeof (v as AgentError).message === "string"
}

export function offlineMessage(o: Offline): string {
  switch (o.reason) {
    case "not_configured":
      return "Control panel not connected. Set OPS_AGENT_URL and OPS_AGENT_SECRET to see your services."
    case "unauthorized":
      return "The agent refused the signature: OPS_AGENT_SECRET differs between web and ops-agent."
    case "unreachable":
    case "error":
      return o.message
  }
}
