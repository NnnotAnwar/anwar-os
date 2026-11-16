import { defineConfig } from "drizzle-kit"

// Migrations run as the database owner (superuser in dev), never as os_app.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./db/migrations",
  schemaFilter: ["public", "auth"],
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
})
