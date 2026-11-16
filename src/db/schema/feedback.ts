import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: feedback. Visitors never write these tables directly: the public form
// goes through app.submit_feedback() (db/modules/feedback.sql), a security
// definer function that validates, rate-limits and inserts for the site owner.

export const feedbackKinds = ["complaint", "suggestion", "question", "thanks"] as const
export type FeedbackKind = (typeof feedbackKinds)[number]

export const feedbackStatuses = ["new", "read", "in_progress", "done", "spam"] as const
export type FeedbackStatus = (typeof feedbackStatuses)[number]

export const feedbackItems = pgTable(
  "feedback_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: feedbackKinds }).notNull(),
    message: text("message").notNull(),
    name: text("name"),
    contact: text("contact"),
    status: text("status", { enum: feedbackStatuses }).notNull().default("new"),
    /** The owner's private notes about how they replied or what they did. */
    replyNote: text("reply_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("feedback_items_owner_created_idx").on(t.ownerId, t.createdAt.desc()),
    index("feedback_items_owner_status_idx").on(t.ownerId, t.status),
    check("feedback_items_kind_valid", sql`${t.kind} in ('complaint', 'suggestion', 'question', 'thanks')`),
    check(
      "feedback_items_status_valid",
      sql`${t.status} in ('new', 'read', 'in_progress', 'done', 'spam')`,
    ),
    check("feedback_items_message_length", sql`char_length(${t.message}) between 10 and 5000`),
    check("feedback_items_name_length", sql`char_length(${t.name}) <= 100`),
    check("feedback_items_contact_length", sql`char_length(${t.contact}) <= 200`),
    check("feedback_items_reply_note_length", sql`char_length(${t.replyNote}) <= 20000`),
  ],
)

/**
 * One row per accepted submission, for rate limiting and replay protection.
 * Holds a salted SHA-256 of the sender's IP (never the IP itself) and the
 * proof-of-work challenge they solved. Rows older than a day are pruned by
 * app.submit_feedback(). No grants to os_app at all.
 */
export const feedbackSubmissions = pgTable(
  "feedback_submissions",
  {
    challenge: text("challenge").primaryKey(),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_submissions_ip_created_idx").on(t.ipHash, t.createdAt.desc())],
)
