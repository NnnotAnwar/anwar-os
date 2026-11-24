import { sql } from "drizzle-orm"
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: notes. RLS policies, triggers and grants live in the SQL migrations
// (the "read published" policy behind /writing: db/modules/notes.sql); Drizzle
// only describes the shape.
export const notesNotes = pgTable(
  "notes_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    pinned: boolean("pinned").notNull().default(false),
    /** Published on /writing/<slug> while true (the site owner's notes only, RLS). */
    isPublic: boolean("is_public").notNull().default(false),
    slug: text("slug"),
    /** Optional summary for /writing and the feed; the body's start otherwise. */
    excerpt: text("excerpt").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notes_notes_owner_updated_idx").on(t.ownerId, t.pinned.desc(), t.updatedAt.desc()),
    uniqueIndex("notes_notes_owner_slug_key").on(t.ownerId, t.slug),
    index("notes_notes_published_idx").on(t.ownerId, t.publishedAt.desc()).where(sql`${t.isPublic}`),
    check("notes_notes_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check("notes_notes_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 80`),
    check("notes_notes_excerpt_length", sql`char_length(${t.excerpt}) <= 300`),
    check(
      "notes_notes_published_complete",
      sql`not ${t.isPublic} or (${t.slug} is not null and ${t.publishedAt} is not null)`,
    ),
  ],
)
