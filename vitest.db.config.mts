import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Integration tests against the Postgres from compose.yaml (`pnpm db:up`).
// Server code can be imported too (e.g. the osbot route handlers in
// osbot-api.test.ts): "@" resolves like in the app and "server-only" is a no-op.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./db/tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["db/tests/**/*.test.ts"],
    fileParallelism: false,
  },
})
