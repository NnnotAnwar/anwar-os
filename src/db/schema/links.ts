import { sql } from "drizzle-orm"
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: links. RLS policies, triggers and grants live in db/modules/links.sql;
// Drizzle only describes the shape.
export const linksLinks = pgTable(
  "links_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    siteName: text("site_name").notNull().default(""),
    faviconUrl: text("favicon_url").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    note: text("note").notNull().default(""),
    isPublic: boolean("is_public").notNull().default(false),
    readLater: boolean("read_later").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("links_links_owner_created_idx").on(t.ownerId, t.createdAt.desc()),
    uniqueIndex("links_links_owner_url_key").on(t.ownerId, t.url),
    index("links_links_tags_idx").using("gin", t.tags),
    check("links_links_url_length", sql`char_length(${t.url}) between 1 and 2048`),
    check("links_links_url_scheme", sql`${t.url} ~* '^https?://'`),
    check("links_links_title_length", sql`char_length(${t.title}) between 1 and 300`),
    check("links_links_description_length", sql`char_length(${t.description}) <= 1000`),
    check("links_links_site_name_length", sql`char_length(${t.siteName}) <= 200`),
    check("links_links_favicon_length", sql`char_length(${t.faviconUrl}) <= 2048`),
    check("links_links_note_length", sql`char_length(${t.note}) <= 5000`),
    check("links_links_tags_count", sql`cardinality(${t.tags}) <= 20`),
  ],
)
