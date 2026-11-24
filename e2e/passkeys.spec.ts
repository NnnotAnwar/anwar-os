// Passkeys in a real browser: Chromium's virtual authenticator (CDP WebAuthn)
// stands in for Touch ID / Windows Hello. Register from Settings, sign in with
// it from /login, rename it, remove it.
import { randomBytes } from "node:crypto"
import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { hashPassword } from "better-auth/crypto"
import postgres from "postgres"
import { settled } from "./support"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const id = `e2e-${randomBytes(4).toString("hex")}`
const email = `${id}@test.local`
const password = randomBytes(12).toString("hex")

test.beforeAll(async () => {
  await admin`insert into auth."user" (id, name, email, email_verified) values (${id}, 'E2E', ${email}, true)`
  await admin`
    insert into auth.account (id, account_id, provider_id, user_id, password)
    values (${`acc-${id}`}, ${id}, 'credential', ${id}, ${await hashPassword(password)})`
})

test.afterAll(async () => {
  await admin`delete from auth."user" where id = ${id}` // cascades to sessions and passkeys
  await admin.end()
})

async function addVirtualAuthenticator(context: BrowserContext, page: Page, { userVerified = true } = {}) {
  const cdp = await context.newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: userVerified,
      automaticPresenceSimulation: true,
    },
  })
}

async function signInWithPassword(page: Page) {
  await page.goto("/login?next=/app/settings")
  await settled(page)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)
}

test("add a passkey, sign in with it, rename and remove it", async ({ context, page }) => {
  // /login also starts a conditional (autofill) passkey request on load, and
  // the virtual authenticator answers it at once, signing in before the button
  // can be clicked (the click then hung on a page being replaced, ~1 run in 4).
  // Hide autofill support so the button is the path under test.
  await page.addInitScript(() => {
    if (window.PublicKeyCredential) PublicKeyCredential.isConditionalMediationAvailable = async () => false
  })
  await addVirtualAuthenticator(context, page)
  await signInWithPassword(page)

  const passkeys = page.getByRole("list", { name: "Your passkeys" })
  await page.getByRole("button", { name: "Add passkey" }).click()
  await expect(page.getByText("Passkey added")).toBeVisible()
  await expect(passkeys.getByRole("listitem")).toHaveCount(1)
  await expect(page.locator(`[aria-label^="Remove"]`)).toHaveCount(1)

  // A second attempt from the same device is refused (one credential per device).
  await page.getByRole("button", { name: "Add passkey" }).click()
  await expect(page.getByText("This device already has a passkey")).toBeVisible()

  // Sign out (drop the session), then come back with the passkey alone.
  await context.clearCookies()
  await page.goto("/login")
  await settled(page)
  await page.getByRole("button", { name: "Sign in with a passkey" }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.goto("/app/settings")
  await page.locator(`[aria-label^="Rename"]`).click()
  await page.getByLabel("Passkey name").fill("E2E laptop")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(passkeys.getByText("E2E laptop")).toBeVisible()

  await page.getByRole("button", { name: "Remove E2E laptop" }).click()
  await page.getByRole("button", { name: "Remove passkey" }).click()
  await expect(page.getByText("Passkey removed")).toBeVisible()
  await expect(passkeys).toHaveCount(0)

  // The removed passkey no longer opens the door.
  await context.clearCookies()
  await page.goto("/login")
  await settled(page)
  await page.getByRole("button", { name: "Sign in with a passkey" }).click()
  await expect(page.getByText("isn't registered here anymore")).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test("an authenticator that can't verify the user can't add a passkey", async ({ context, page }) => {
  await addVirtualAuthenticator(context, page, { userVerified: false })
  await signInWithPassword(page)
  const verify = page.waitForRequest(/passkey\/verify-registration/, { timeout: 3000 }).catch(() => null)
  await page.getByRole("button", { name: "Add passkey" }).click()
  // The browser refuses (user verification is required), so nothing reaches the server.
  expect(await verify).toBeNull()
  await expect(page.getByRole("button", { name: "Add passkey" })).toBeEnabled()
  await expect(page.getByRole("list", { name: "Your passkeys" })).toHaveCount(0)
})
