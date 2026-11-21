/**
 * pnpm e2e: the browser tests against a production build, self-contained.
 *
 *   1. a throwaway Postgres container (same image and role setup as compose.yaml)
 *   2. migrations, then an owner seeded with scripts/create-owner.mts
 *   3. next build (skip with E2E_SKIP_BUILD=1 when the build is current)
 *   4. next start on 127.0.0.1:3304 (E2E_PORT; the site is http://localhost:3304),
 *      NODE_ENV=production, so the CSP,
 *      the service worker and the rate limits run as in production
 *   5. playwright test (extra arguments are passed through), then cleanup
 *
 *   pnpm e2e                       everything
 *   pnpm e2e e2e/notes.spec.ts     one spec
 *   E2E_SKIP_BUILD=1 pnpm e2e      reuse .next from the last build
 *
 * Needs Docker and Playwright's Chromium (pnpm exec playwright install chromium).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const port = Number(process.env.E2E_PORT ?? 3304)
const dbPort = Number(process.env.E2E_DB_PORT ?? 55479)
const container = `anwar-os-e2e-${randomBytes(3).toString("hex")}`
// The server listens on 127.0.0.1, but the site is addressed as localhost:
// browsers refuse WebAuthn (passkeys) on an IP-address origin ("invalid
// domain"), and localhost is a secure context like the real https site.
// Playwright's contexts are isolated, so other dev servers' localhost cookies
// can't leak in.
const baseURL = `http://localhost:${port}`

type Env = Record<string, string | undefined>

const env: NodeJS.ProcessEnv = {
  ...process.env,
  POSTGRES_PASSWORD: "e2e",
  OS_APP_PASSWORD: "e2e",
  DATABASE_URL: `postgres://os_app:e2e@127.0.0.1:${dbPort}/anwar_os`,
  MIGRATION_DATABASE_URL: `postgres://postgres:e2e@127.0.0.1:${dbPort}/anwar_os`,
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  BETTER_AUTH_URL: baseURL,
  E2E_BASE_URL: baseURL,
  E2E_OWNER_EMAIL: "owner@e2e.test",
  E2E_OWNER_PASSWORD: randomBytes(12).toString("hex"),
  // No object storage, Google or Telegram in the browser tests.
  S3_ENDPOINT: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  OSBOT_TOKEN: "",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "production",
}

let server: ChildProcess | undefined

function log(message: string) {
  console.log(`\x1b[36me2e\x1b[0m ${message}`)
}

function run(command: string, args: string[], extra: Env = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...extra } as NodeJS.ProcessEnv, stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`)
}

function cleanup() {
  if (server && server.exitCode === null) server.kill("SIGTERM")
  spawnSync("docker", ["rm", "-f", "-v", container], { stdio: "ignore" })
}

async function waitFor(check: () => Promise<boolean> | boolean, what: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

process.on("SIGINT", () => {
  cleanup()
  process.exit(130)
})

let exitCode = 1
try {
  log(`Postgres container ${container} on 127.0.0.1:${dbPort}`)
  run("docker", [
    "run", "-d", "--rm", "--name", container,
    "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=e2e", "-e", "POSTGRES_DB=anwar_os", "-e", "OS_APP_PASSWORD=e2e",
    "-p", `127.0.0.1:${dbPort}:5432`,
    "-v", `${root}db/init:/docker-entrypoint-initdb.d:ro`,
    "postgres:17-alpine",
  ])
  // pg_isready over TCP: the init script runs against a socket-only server first.
  await waitFor(
    () => spawnSync("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "anwar_os"]).status === 0,
    "Postgres",
    60_000,
  )

  log("migrations")
  run("node", ["./node_modules/drizzle-kit/bin.cjs", "migrate"])
  log("owner")
  run("node", ["scripts/create-owner.mts", env.E2E_OWNER_EMAIL!], { OWNER_PASSWORD: env.E2E_OWNER_PASSWORD })

  if (process.env.E2E_SKIP_BUILD !== "1") {
    log("next build")
    run("node", ["./node_modules/next/dist/bin/next", "build"])
  }

  log(`next start on ${baseURL}`)
  server = spawn("node", ["./node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  })
  await waitFor(
    async () => {
      try {
        return (await fetch(`${baseURL}/api/health`)).ok
      } catch {
        return false
      }
    },
    "the app",
    60_000,
  )

  log("playwright test")
  const tests = spawnSync("node", ["./node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], {
    cwd: root,
    env,
    stdio: "inherit",
  })
  exitCode = tests.status ?? 1
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
} finally {
  cleanup()
}
process.exit(exitCode)
