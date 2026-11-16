// Drives the real Better Auth configuration (src/lib/auth-config.ts) over HTTP
// requests against the test database, connected as os_app like the web app.
import { createHmac, randomBytes } from "node:crypto"
import { hashPassword } from "better-auth/crypto"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "../../../src/db/schema"
import { createAuth, type AuthEnv } from "../../../src/lib/auth-config"

export const BASE = "http://127.0.0.1:3308"

export function openDatabases() {
  const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
  const app = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} })
  return { admin, app, db: drizzle(app, { schema }) }
}

export function testAuth(db: ReturnType<typeof openDatabases>["db"], env: Partial<AuthEnv> = {}) {
  return createAuth(db, {
    secret: "test-secret-for-auth-integration-tests-0123456789",
    baseURL: BASE,
    googleClientId: "test-client-id.apps.googleusercontent.com",
    googleClientSecret: "test-client-secret",
    ...env,
  })
}

/** A user with an email + password account, created as the migration role. */
export async function createUser(admin: postgres.Sql, label: string, password = "correct horse battery staple") {
  const id = `test-${label}-${randomBytes(4).toString("hex")}`
  const email = `${id}@test.local`
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${id}, ${label}, ${email}, true)`
  await admin`
    insert into auth.account (id, account_id, provider_id, user_id, password)
    values (${`acc-${id}`}, ${id}, 'credential', ${id}, ${await hashPassword(password)})`
  return { id, email, password }
}

/** A tiny cookie jar: one browser. */
export class Browser {
  cookies = new Map<string, string>()

  async request(auth: ReturnType<typeof testAuth>, path: string, init: { method?: string; body?: unknown; userAgent?: string } = {}) {
    const headers = new Headers({ origin: BASE })
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "))
    if (init.body !== undefined) headers.set("content-type", "application/json")
    if (init.userAgent) headers.set("user-agent", init.userAgent)
    const url = path.startsWith("http") ? path : `${BASE}/api/auth${path}`
    const response = await auth.handler(
      new Request(url, {
        method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        redirect: "manual",
      }),
    )
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";")
      const index = pair!.indexOf("=")
      const name = pair!.slice(0, index).trim()
      const value = pair!.slice(index + 1).trim()
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === ""
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return response
  }

  has(fragment: string) {
    return [...this.cookies.keys()].some((name) => name.includes(fragment))
  }
}

export async function json<T = Record<string, unknown>>(response: Response) {
  return (await response.json()) as T
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), for driving the 2FA endpoints. */
export function totp(base32Secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0")
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const hmac = createHmac("sha1", key).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return code.toString().padStart(6, "0")
}
