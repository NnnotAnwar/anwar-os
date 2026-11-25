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

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const g = globalThis as typeof globalThis & { __aosErrorLogListeners?: boolean }
  // Dev reloads re-run register(); listen once per process.
  if (g.__aosErrorLogListeners) return
  g.__aosErrorLogListeners = true
  process.on("unhandledRejection", (reason) => void record(reason, { routeType: "process" }))
  process.on("uncaughtExceptionMonitor", (error) => void record(error, { routeType: "process" }))
}
