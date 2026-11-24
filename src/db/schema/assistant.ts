import { sql } from "drizzle-orm"
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: assistant (the AI chat in /app/assistant, src/modules/assistant) and
// the token log of every Claude call the app makes (chat turns and receipt
// photos). RLS, the same-owner foreign key and grants: db/modules/assistant.sql.
//
// Messages are stored exactly as the Claude Messages API sent or received them
// (`content` = content blocks, thinking blocks and their signatures included),
// so a conversation is replayed append-only: earlier turns are never edited,
// which keeps the prompt cache and preserved thinking valid.

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

export const assistantMessageKinds = ["user", "assistant", "tool_results"] as const
export type AssistantMessageKind = (typeof assistantMessageKinds)[number]

export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    title: text("title").notNull().default("New chat"),
    /** The model the conversation runs on (caches and thinking blocks are per model). */
    model: text("model").notNull(),
    /**
     * Tool calls waiting for the user's confirm card, or null:
     * { assistantMessageId, calls: [{ id, name, input }], ready: [tool_result blocks of the turn's read calls] }.
     */
    pending: jsonb("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("assistant_conversations_owner_id_key").on(t.ownerId, t.id),
    index("assistant_conversations_owner_updated_idx").on(t.ownerId, t.updatedAt.desc()),
    check("assistant_conversations_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("assistant_conversations_model_length", sql`char_length(${t.model}) between 1 and 80`),
  ],
)

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Global order; a conversation's messages are read by seq. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    ownerId: ownerId(),
    /** Same-owner FK (owner_id, conversation_id) → conversations, on delete cascade: db/modules/assistant.sql. */
    conversationId: uuid("conversation_id").notNull(),
    /** user: typed by the owner · assistant: Claude's reply · tool_results: what the tools returned. */
    kind: text("kind").$type<AssistantMessageKind>().notNull(),
    /** Content blocks as sent to / received from the API. */
    content: jsonb("content").notNull(),
    /** For the UI only (never sent to the API): typed text, tool chips, decisions, stop reason. */
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_messages_conversation_seq_idx").on(t.ownerId, t.conversationId, t.seq),
    check("assistant_messages_kind", sql`${t.kind} in ('user', 'assistant', 'tool_results')`),
  ],
)

export const assistantUsageKinds = ["chat", "receipt"] as const
export type AssistantUsageKind = (typeof assistantUsageKinds)[number]

/** One row per Claude API response, for the monthly usage line and cost awareness. */
export const assistantUsage = pgTable(
  "assistant_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    /** Chat turns only; null for receipt photos. Set null if the chat is deleted. */
    conversationId: uuid("conversation_id"),
    kind: text("kind").$type<AssistantUsageKind>().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Estimated cost in millionths of a US dollar (list prices at the time of writing). */
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_usage_owner_created_idx").on(t.ownerId, t.createdAt.desc()),
    check("assistant_usage_kind", sql`${t.kind} in ('chat', 'receipt')`),
    check(
      "assistant_usage_tokens_nonnegative",
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.cacheReadTokens} >= 0 and ${t.cacheWriteTokens} >= 0 and ${t.costMicroUsd} >= 0`,
    ),
  ],
)
