import { boolean, index, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core"

// Better Auth tables, kept in their own schema. Field names (JS keys) follow
// Better Auth's model; column names are snake_case.
export const authSchema = pgSchema("auth")

export const appRoles = ["owner", "demo", "user"] as const
export type AppRole = (typeof appRoles)[number]

export const user = authSchema.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Authorization role. Not writable by the app role (column grants in migrations).
  role: text("role", { enum: appRoles }).notNull().default("user"),
  timezone: text("timezone").notNull().default("Europe/Prague"),
  locale: text("locale").notNull().default("en"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
})

export const session = authSchema.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
)

export const account = authSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
)

export const verification = authSchema.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
)

export const twoFactor = authSchema.table(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factor_user_id_idx").on(t.userId), index("two_factor_secret_idx").on(t.secret)],
)

// WebAuthn credentials (Better Auth passkey plugin). The public key is not a
// secret; a credential ID identifies one credential on one authenticator.
export const passkey = authSchema.table(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull().unique(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_id_idx").on(t.userId)],
)

/**
 * Attempt counters for sign-in and the other auth endpoints (src/lib/rate-limit.ts),
 * shared by Better Auth's HTTP limiter and the sign-in server actions. In
 * Postgres, not memory, so a deploy's restart doesn't reset an attacker's count.
 * One row per key (e.g. "sign-in:ip:203.0.113.7"), fixed windows.
 */
export const rateLimit = authSchema.table(
  "rate_limit",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_limit_window_start_idx").on(t.windowStart)],
)
