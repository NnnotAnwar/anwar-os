import "server-only"
import { connection } from "next/server"
import { getViewer } from "@/core/auth"
import { runSearch } from "@/core/search"

const noStore = { "Cache-Control": "private, no-store" }

/**
 * GET /api/search?q=coffee[&m=budget]: global search for the signed-in viewer.
 * A GET so the client can cancel a stale request (AbortController) when the
 * query changes; the answer is never cached.
 */
export async function GET(request: Request) {
  // Never prerender: the answer depends on the session.
  await connection()
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: "Sign in to search." }, { status: 401, headers: noStore })

  const params = new URL(request.url).searchParams
  const result = await runSearch(viewer, params.get("q") ?? "", { module: params.get("m"), signal: request.signal })
  return Response.json(result, { headers: noStore })
}
