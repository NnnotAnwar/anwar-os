"use server"

import { revalidatePath } from "next/cache"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { getServices } from "@/core/services"
import { corePreferences } from "@/db/schema"

const input = z.object({
  id: z.string().min(1).max(40),
  change: z.enum(["pin", "unpin", "earlier", "later"]),
})

/**
 * Pin / unpin a service, or move a pinned one. Returns the previous list so
 * the toast's Undo can restore it exactly.
 */
export async function changeService(raw: { id: string; change: "pin" | "unpin" | "earlier" | "later" }) {
  const { id, change } = input.parse(raw)
  const { all, pinnedIds } = await getServices()
  if (!all.some((m) => m.id === id)) throw new Error("Unknown service")

  const next = [...pinnedIds]
  const at = next.indexOf(id)
  if (change === "pin" && at === -1) next.push(id)
  if (change === "unpin" && at !== -1) next.splice(at, 1)
  if ((change === "earlier" && at > 0) || (change === "later" && at !== -1 && at < next.length - 1)) {
    const to = change === "earlier" ? at - 1 : at + 1
    ;[next[at], next[to]] = [next[to]!, next[at]!]
  }

  await savePinned(next)
  return { previous: pinnedIds }
}

/** Restores an exact list (Undo). Unknown ids are dropped. */
export async function restoreServices(ids: string[]) {
  const parsed = z.array(z.string().max(40)).max(50).parse(ids)
  const { all } = await getServices()
  const known = new Set(all.map((m) => m.id))
  await savePinned(parsed.filter((id) => known.has(id)))
}

async function savePinned(ids: string[]) {
  await asViewer((tx) =>
    tx
      .insert(corePreferences)
      .values({ pinnedServices: ids })
      .onConflictDoUpdate({ target: corePreferences.ownerId, set: { pinnedServices: sql`excluded.pinned_services` } }),
  )
  revalidatePath("/app", "layout")
}
