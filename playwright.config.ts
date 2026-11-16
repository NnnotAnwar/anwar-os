import { defineConfig, devices } from "@playwright/test"

// Browser tests against a running dev server (they don't start one):
//   pnpm dev --hostname 127.0.0.1 --port 3308   (BETTER_AUTH_URL=http://127.0.0.1:3308)
//   pnpm test:e2e                                (E2E_BASE_URL overrides the URL)
// They create and delete their own throwaway user through MIGRATION_DATABASE_URL.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3308",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
