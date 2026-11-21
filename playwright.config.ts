import { defineConfig, devices } from "@playwright/test"

// Browser tests. Two ways to run them:
//
//   pnpm e2e        everything self-contained (scripts/e2e.mts): its own Postgres
//                   container, `next build && next start` on port 3304, a
//                   seeded owner; cleans up afterwards. This is what CI runs.
//   pnpm test:e2e   against a server you already run, e.g.
//                   pnpm dev --hostname 127.0.0.1 --port 3308 (BETTER_AUTH_URL to
//                   match; E2E_BASE_URL overrides the URL), with E2E_OWNER_EMAIL /
//                   E2E_OWNER_PASSWORD for an owner without 2FA. Passkey specs
//                   need a localhost origin: browsers refuse WebAuthn on an IP.
//
// Password sign-ins are rate-limited per address in production builds (10 per
// 15 min, src/lib/rate-limit.ts); the whole suite uses 9. Reuse the owner
// session (storageState: OWNER) instead of signing in again.
//
// Specs create and delete their own throwaway users through
// MIGRATION_DATABASE_URL; owner sessions come from e2e/auth.setup.ts.
const phone = {
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
}

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3308",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /mobile\.spec\.ts/,
    },
    { name: "phone", use: phone, dependencies: ["setup"], testMatch: /mobile\.spec\.ts/ },
  ],
})
