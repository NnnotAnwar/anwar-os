// Shared helpers for the browser tests.
import { createHmac, randomBytes } from "node:crypto"
import { expect, type Page } from "@playwright/test"
import { hashPassword } from "better-auth/crypto"
import postgres from "postgres"

/** Owner session saved by auth.setup.ts; specs opt in with test.use({ storageState: OWNER }). */
export const OWNER = "e2e/.auth/owner.json"

export function ownerCredentials() {
  const email = process.env.E2E_OWNER_EMAIL
  const password = process.env.E2E_OWNER_PASSWORD
  if (!email || !password) throw new Error("Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD (pnpm e2e does).")
  return { email, password }
}

export function adminDb() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
}

/** A throwaway user with an email + password account (role "user"). */
export async function createUser(admin: postgres.Sql, label: string) {
  const id = `e2e-${label}-${randomBytes(4).toString("hex")}`
  const email = `${id}@test.local`
  const password = randomBytes(12).toString("hex")
  await admin`insert into auth."user" (id, name, email, email_verified) values (${id}, ${label}, ${email}, true)`
  await admin`
    insert into auth.account (id, account_id, provider_id, user_id, password)
    values (${`acc-${id}`}, ${id}, 'credential', ${id}, ${await hashPassword(password)})`
  return { id, email, password }
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), computed from the key shown in Settings. */
export function totp(base32Secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of base32Secret.replace(/=+$/, "").replace(/\s/g, "").toUpperCase()) {
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

export async function signInWithPassword(page: Page, { email, password }: { email: string; password: string }, next = "/app") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

/**
 * Records Content-Security-Policy violations on the page from the very first
 * script on (init scripts run before the page's own and aren't subject to CSP).
 */
export async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI || "inline"}`)
    })
  })
  return async () => (await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)) ?? []
}

/** The page never scrolls sideways (375 px phones). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    return { scroll: root.scrollWidth, client: root.clientWidth }
  })
  expect(overflow.scroll, `page is ${overflow.scroll}px wide in a ${overflow.client}px viewport`).toBeLessThanOrEqual(overflow.client)
}
