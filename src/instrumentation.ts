// Next instrumentation (server). Feeds the self-hosted error log (Ops →
// Errors, src/modules/ops/errors.ts):
//   onRequestError  every error Next catches while serving a request: Server
//                   Component renders, route handlers, server actions, the proxy
//   register        unhandled rejections and uncaught exceptions outside a
//                   request (Next itself keeps the process alive and logs them)
// Only the Node.js runtime records (the database client is Node-only). The
// recorder is imported lazily, so neither the build nor a missing
// DATABASE_URL is affected, and it never throws.
import type { Instrumentation } from "next"

type RouteType = "render" | "route" | "action" | "proxy"

async function record(error: unknown, ctx: { route?: string; method?: string; routeType: RouteType | "process"; renderSource?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return
  const { recordError } = await import("@/modules/ops/errors")
  await recordError(error, { source: "web", ...ctx })
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await record(error, {
    // The route file's pattern (/app/notes/[id]) groups better than the path
    // and carries no ids; the path is the fallback, without its query string.
    route: context.routePath || request.path,
    method: request.method,
    routeType: context.routeType,
    renderSource: "renderSource" in context ? context.renderSource : undefined,
  })
}

export async function register() {
  // process.on is Node-only: kept in its own file and imported only there, so
  // the Edge build of this file doesn't see it (Next's documented pattern).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { listenForProcessErrors } = await import("./instrumentation-node")
    listenForProcessErrors((error) => record(error, { routeType: "process" }))
  }
}
