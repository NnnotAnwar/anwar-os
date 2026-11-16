import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Integration tests against the Postgres from compose.yaml (`pnpm db:up`).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["db/tests/**/*.test.ts"],
    fileParallelism: false,
  },
})
