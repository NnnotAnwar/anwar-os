import { handleSync } from "@/core/offline-sync"

/** The offline outbox lands here (src/core/offline-sync.ts). */
export async function POST(request: Request, ctx: RouteContext<"/api/sync/[kind]">) {
  const { kind } = await ctx.params
  return handleSync(request, kind)
}
