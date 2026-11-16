import { sql } from "drizzle-orm"
import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: notes. RLS policies, triggers and grants live in the SQL migration
// db/migrations/*_rls.sql; Drizzle only describes the shape.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notes_notes_owner_updated_idx").on(t.ownerId, t.pinned.desc(), t.updatedAt.desc()),
    check("notes_notes_title_length", sql`char_length(${t.title}) between 1 and 200`),
  ],
)
