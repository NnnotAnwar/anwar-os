import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Personal API tokens (Settings → API tokens): Bearer access for the MCP server
// (/api/mcp) and the Shortcuts API (/api/v1/*). Only a SHA-256 of each token is
// stored; `prefix` (the first 12 characters, "aos_" + 8) finds the row and is
// shown in the list. The app role can't read `token_hash` back, and a request
// authenticated by a token can't see or change this table at all.
// RLS, grants and app.authenticate_api_token(): db/modules/core-api-tokens.sql.

export const apiTokenScopes = ["read", "write"] as const
export type ApiTokenScope = (typeof apiTokenScopes)[number]

export const coreApiTokens = pgTable(
  "core_api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull().unique(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes").array().$type<ApiTokenScope[]>().notNull().default(sql`'{read}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("core_api_tokens_owner_created_idx").on(t.ownerId, t.createdAt),
    check("core_api_tokens_name_length", sql`char_length(${t.name}) between 1 and 60`),
    check("core_api_tokens_prefix_format", sql`${t.prefix} ~ '^aos_[A-Za-z0-9]{8}$'`),
    check("core_api_tokens_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("core_api_tokens_scopes_valid", sql`${t.scopes} <@ array['read', 'write']::text[] and 'read' = any(${t.scopes})`),
  ],
)
