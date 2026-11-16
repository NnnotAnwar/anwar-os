import { defineConfig } from "vitest/config"

// Integration tests against the Postgres from compose.yaml (`pnpm db:up`).
export default defineConfig({
  test: {
    include: ["db/tests/**/*.test.ts"],
    fileParallelism: false,
  },
})
