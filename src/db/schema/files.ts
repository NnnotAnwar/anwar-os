import { sql } from "drizzle-orm"
import { bigint, check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: files (knowledge base). RLS policies, triggers and grants live in
// db/modules/files.sql; Drizzle only describes the shape.
//
// Folder links are composite (owner_id, folder_id) foreign keys, so a row can
// only point at a folder of the same owner. Foreign-key checks bypass RLS, and
// without this a user could attach rows to (or cascade-delete through) someone
// else's folder id.

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const filesFolders = pgTable(
  "files_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    /** Null for top-level folders. */
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("files_folders_owner_id_key").on(t.ownerId, t.id),
    // Sibling names are unique, including at the top level (null parent).
    unique("files_folders_sibling_name_key").on(t.ownerId, t.parentId, t.name).nullsNotDistinct(),
    foreignKey({
      name: "files_folders_parent_fk",
      columns: [t.ownerId, t.parentId],
      foreignColumns: [t.ownerId, t.id],
    }).onDelete("cascade"),
    index("files_folders_owner_parent_idx").on(t.ownerId, t.parentId),
    check("files_folders_name_valid", sql`char_length(${t.name}) between 1 and 120 and ${t.name} !~ '[/\\\\]'`),
    check("files_folders_not_own_parent", sql`${t.parentId} is distinct from ${t.id}`),
  ],
)

export const filesFiles = pgTable(
  "files_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    folderId: uuid("folder_id"),
    name: text("name").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    mime: text("mime").notNull(),
    /** Object key in the bucket: `<owner_id>/<uuid>`. The row is the source of truth. */
    storageKey: text("storage_key").notNull().unique("files_files_storage_key_key"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    description: text("description").notNull().default(""),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "files_files_folder_fk",
      columns: [t.ownerId, t.folderId],
      foreignColumns: [filesFolders.ownerId, filesFolders.id],
    }).onDelete("cascade"),
    index("files_files_owner_folder_idx").on(t.ownerId, t.folderId),
    index("files_files_owner_created_idx").on(t.ownerId, t.createdAt.desc()),
    check("files_files_name_length", sql`char_length(${t.name}) between 1 and 255`),
    check("files_files_size_range", sql`${t.sizeBytes} between 0 and 104857600`),
    check("files_files_description_length", sql`char_length(${t.description}) <= 2000`),
    check("files_files_tags_count", sql`cardinality(${t.tags}) <= 20`),
    // Keys always live under the owner's prefix, whatever the app sends.
    check("files_files_key_in_owner_prefix", sql`starts_with(${t.storageKey}, ${t.ownerId} || '/')`),
  ],
)

export const filesDocuments = pgTable(
  "files_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    folderId: uuid("folder_id"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "files_documents_folder_fk",
      columns: [t.ownerId, t.folderId],
      foreignColumns: [filesFolders.ownerId, filesFolders.id],
    }).onDelete("cascade"),
    index("files_documents_owner_folder_idx").on(t.ownerId, t.folderId),
    index("files_documents_owner_updated_idx").on(t.ownerId, t.updatedAt.desc()),
    check("files_documents_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check("files_documents_body_length", sql`char_length(${t.body}) <= 200000`),
  ],
)
