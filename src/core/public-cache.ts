import "server-only"
import { revalidateTag } from "next/cache"
import type { ActionDef } from "@/core/module"

// The public site (projects, notes, CV, ideas, /now) is cached for days and
// dropped by tag when the owner changes something. The editors' Server
// Actions call updateTag themselves, but the same actions also run from MCP,
// the REST API, the Telegram bots and the assistant, none of which went
// through them: an edit made there stayed invisible on the public pages until
// the cache expired. So the module's write actions drop the tags themselves.

/**
 * Marks `tags` stale with no stale window: the next visit renders fresh data.
 * Outside a request (tests, scripts) there's no cache to drop; that's not an error.
 */
export function dropPublicCache(tags: readonly string[]) {
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 })
    } catch {
      // No request scope: nothing of the public site's cache lives here.
    }
  }
}

/**
 * Wraps a module's actions so every successful write action drops `tags`
 * (a failed one changed nothing). Reads are left as they are.
 */
export function droppingPublicCache<T extends Record<string, ActionDef>>(tags: readonly string[], actions: T): T {
  const wrapped: Record<string, ActionDef> = {}
  for (const [name, action] of Object.entries(actions)) {
    wrapped[name] =
      action.kind === "write"
        ? {
            ...action,
            handler: async (input) => {
              const result = await action.handler(input)
              dropPublicCache(tags)
              return result
            },
          }
        : action
  }
  return wrapped as T
}
