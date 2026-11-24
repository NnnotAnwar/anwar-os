import "server-only"
import { and, asc, desc, eq } from "drizzle-orm"
import { recordUsage } from "@/core/ai-usage"
import { asViewer } from "@/core/auth"
import { assistantConversations as c, assistantMessages as m } from "@/db/schema"
import type { EngineStore, Pending } from "./engine"
import { type Block, type MessageKind, type StoredMessage } from "./lib/history"
import type { ConversationSummary } from "./lib/protocol"

// Conversations and messages in Postgres, always as the viewer (RLS: own rows).

export type Conversation = { id: string; title: string; model: string; pending: Pending | null; updatedAt: Date }

export async function listConversations(limit = 50): Promise<ConversationSummary[]> {
  const rows = await asViewer((tx) =>
    tx.select({ id: c.id, title: c.title, updatedAt: c.updatedAt }).from(c).orderBy(desc(c.updatedAt)).limit(limit),
  )
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }))
}

export async function getConversation(id: string): Promise<{ conversation: Conversation; messages: StoredMessage[] } | null> {
  return asViewer(async (tx) => {
    const [row] = await tx.select().from(c).where(eq(c.id, id))
    if (!row) return null
    const rows = await tx
      .select({ id: m.id, kind: m.kind, content: m.content, meta: m.meta })
      .from(m)
      .where(and(eq(m.ownerId, row.ownerId), eq(m.conversationId, id)))
      .orderBy(asc(m.seq))
    return {
      conversation: { id: row.id, title: row.title, model: row.model, pending: (row.pending as Pending | null) ?? null, updatedAt: row.updatedAt },
      messages: rows.map((r) => ({ id: r.id, kind: r.kind, content: r.content as Block[], meta: (r.meta ?? {}) as StoredMessage["meta"] })),
    }
  })
}

export async function createConversation(title: string, model: string): Promise<Conversation> {
  const [row] = await asViewer((tx) => tx.insert(c).values({ title, model }).returning())
  return { id: row!.id, title: row!.title, model: row!.model, pending: null, updatedAt: row!.updatedAt }
}

export async function deleteConversation(id: string): Promise<boolean> {
  const rows = await asViewer((tx) => tx.delete(c).where(eq(c.id, id)).returning({ id: c.id }))
  return rows.length > 0
}

export async function renameConversation(id: string, title: string) {
  await asViewer((tx) => tx.update(c).set({ title }).where(eq(c.id, id)))
}

/** The engine's view of one conversation's storage. */
export function conversationStore(conversationId: string): EngineStore {
  return {
    async append(kind: MessageKind, content: Block[], meta: StoredMessage["meta"]) {
      const row = await asViewer(async (tx) => {
        const [inserted] = await tx.insert(m).values({ conversationId, kind, content, meta }).returning({ id: m.id })
        await tx.update(c).set({ updatedAt: new Date() }).where(eq(c.id, conversationId))
        return inserted!
      })
      return { id: row.id, kind, content, meta }
    },
    async setPending(pending) {
      await asViewer((tx) => tx.update(c).set({ pending }).where(eq(c.id, conversationId)))
    },
    async usage(model, usage) {
      await recordUsage({ kind: "chat", model, usage, conversationId })
    },
  }
}
