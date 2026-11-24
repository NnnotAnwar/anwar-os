/**
 * Sending the outbox (src/lib/offline/outbox.ts) to the server, oldest first.
 * Pure apart from the injected `send`, so it is unit-tested with a fake
 * IndexedDB and a fake server.
 *
 * Items go through POST /api/sync/<kind>, a plain route handler, never a
 * Server Action: an action's id changes with every deploy, so a capture made
 * offline before a deploy and sent after it would hit "Failed to find Server
 * Action". The route's contract is stable:
 *
 *   request   { id, userId, capturedAt, payload }   (JSON, same origin, session cookie)
 *   200       { ok: true, value }                    saved (or already saved: same id)
 *   401                                              signed out: stop, keep everything
 *   409       { error: "other_user" }                another account's item: leave it alone
 *   4xx       { message }                            refused: this item fails, the rest go on
 *   5xx, 408, 429, network error                     try again later: stop here, keep order
 */
import type { Outbox, OutboxItem } from "./outbox"

export type SendOutcome =
  | { type: "ok"; value: unknown }
  /** The server refused this item for good (validation, a module the user can't use). */
  | { type: "rejected"; error: string }
  | { type: "signed-out" }
  /** Made under another account on this device; the current session must not send it. */
  | { type: "other-user" }
  /** Didn't get through or the server failed: send it again later. */
  | { type: "retry"; error: string }

export type SyncStop = "signed-out" | "retry"

export type SyncReport = {
  synced: { item: OutboxItem; value: unknown }[]
  failed: { item: OutboxItem; error: string }[]
  /** Why the run ended early, if it did. */
  stopped: SyncStop | null
  /** The last transient error, when stopped for "retry". */
  error: string | null
}

const GENERIC_REJECTION = "The server didn't accept this. Edit it in the app or discard it."
export const OFFLINE_ERROR = "Couldn't reach anwar.os. It will be sent when you're back online."

/** Turns an HTTP answer from /api/sync into what the sync loop does next. */
export function classifyResponse(status: number, body: unknown): SendOutcome {
  const data = (body && typeof body === "object" ? body : {}) as { ok?: unknown; value?: unknown; error?: unknown; message?: unknown }
  if (status >= 200 && status < 300 && data.ok === true) return { type: "ok", value: data.value }
  if (status === 401) return { type: "signed-out" }
  if (status === 409 && data.error === "other_user") return { type: "other-user" }
  const message = typeof data.message === "string" && data.message ? data.message : null
  if (status === 408 || status === 429 || status >= 500 || (status >= 200 && status < 300)) {
    return { type: "retry", error: message ?? `The server answered ${status}. Trying again later.` }
  }
  return { type: "rejected", error: message ?? GENERIC_REJECTION }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Sends one item to its route and classifies the answer. Never throws. */
export async function sendItem(item: OutboxItem, fetchImpl: FetchLike = fetch, timeoutMs = 20_000): Promise<SendOutcome> {
  let response: Response
  try {
    response = await fetchImpl(`/api/sync/${item.kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, userId: item.userId, capturedAt: item.capturedAt, payload: item.payload }),
      credentials: "same-origin",
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined,
    })
  } catch {
    return { type: "retry", error: OFFLINE_ERROR }
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Not JSON: a proxy error page, a redirect to /login…
  }
  if (response.redirected && new URL(response.url, "http://x").pathname === "/login") return { type: "signed-out" }
  return classifyResponse(response.status, body)
}

/**
 * Sends `userId`'s pending items oldest first. A refused item is marked failed
 * and the run goes on; a transient error stops the run, so later items never
 * overtake an earlier one; signed out stops it too. Callers make sure only one
 * run happens at a time (Web Locks, src/lib/offline/client.ts); if two do
 * anyway, the server's idempotency keeps the result correct.
 */
export async function syncOutbox({
  outbox,
  userId,
  send,
  onSynced,
}: {
  outbox: Outbox
  userId: string
  send: (item: OutboxItem) => Promise<SendOutcome>
  onSynced?: (item: OutboxItem, value: unknown) => void
}): Promise<SyncReport> {
  const report: SyncReport = { synced: [], failed: [], stopped: null, error: null }
  const items = (await outbox.list(userId)).filter((item) => item.status === "pending")

  for (const listed of items) {
    // Discarded or sent by another tab since the list was read.
    const item = await outbox.get(listed.id)
    if (!item || item.status !== "pending") continue

    const outcome = await send(item)
    switch (outcome.type) {
      case "ok":
        await outbox.remove(item.id)
        report.synced.push({ item, value: outcome.value })
        onSynced?.(item, outcome.value)
        break
      case "rejected":
        await outbox.markFailed(item.id, outcome.error)
        report.failed.push({ item, error: outcome.error })
        break
      case "other-user":
        break
      case "signed-out":
        report.stopped = "signed-out"
        return report
      case "retry":
        await outbox.noteAttempt(item.id, outcome.error)
        report.stopped = "retry"
        report.error = outcome.error
        return report
    }
  }
  return report
}

/** Seconds to wait before the next automatic attempt after `failures` transient failures in a row. */
export function retryDelay(failures: number): number {
  const steps = [5, 15, 30, 60, 120, 300]
  return steps[Math.min(Math.max(failures, 1), steps.length) - 1]!
}
