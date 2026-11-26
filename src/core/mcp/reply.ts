// How /api/mcp hands the SDK's reply back to Next (server.ts). Plain web APIs, unit-tested in reply.test.ts.

/** True when the JSON-RPC body (one message or a batch) calls a tool. */
export async function callsTool(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false
  try {
    const body: unknown = await request.clone().json()
    const messages = Array.isArray(body) ? body : [body]
    return messages.some((m) => (m as { method?: unknown } | null)?.method === "tools/call")
  } catch {
    return false
  }
}

/**
 * The reply as it goes out. A tool call's reply is read to the end first: the
 * SDK answers with an SSE stream at once and runs the tool while it streams,
 * but Next applies the cache tags a route dropped (revalidateTag, see
 * src/core/public-cache.ts) only up to the moment the route returns. Waiting
 * for the whole single-exchange reply keeps a write's public-cache drop.
 */
export async function finishReply(response: Response, waitForBody: boolean): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  headers.set("X-Robots-Tag", "noindex")
  const body = waitForBody && response.body ? await response.arrayBuffer() : response.body
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}
