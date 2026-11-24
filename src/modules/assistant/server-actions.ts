"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { ConversationSummary } from "./lib/protocol"
import { deleteConversation, listConversations } from "./store"

const id = z.uuid()

/** Deletes a chat and its messages (its token log stays, unlinked). */
export async function deleteChat(raw: unknown): Promise<{ ok: boolean }> {
  const parsed = id.safeParse(raw)
  if (!parsed.success) return { ok: false }
  const ok = await deleteConversation(parsed.data)
  revalidatePath("/app/assistant", "layout")
  return { ok }
}

export async function recentChats(): Promise<ConversationSummary[]> {
  return listConversations()
}
