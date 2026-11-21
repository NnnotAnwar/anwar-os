// Password sign-in, then two-factor: set up TOTP in Settings with a code computed
// here from the key the page shows, sign in with a code, then with a backup code.
import { expect, test } from "@playwright/test"
import { adminDb, createUser, signInWithPassword, totp } from "./support"

const admin = adminDb()
let user: Awaited<ReturnType<typeof createUser>>

test.beforeAll(async () => {
  user = await createUser(admin, "mfa")
})

test.afterAll(async () => {
  await admin`delete from auth."user" where id = ${user.id}`
  await admin.end()
})

test("a wrong password is refused without saying which part was wrong", async ({ page }) => {
  await signInWithPassword(page, { email: user.email, password: "not the password" })
  await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test("private pages send signed-out visitors to sign in, and back afterwards", async ({ page }) => {
  await page.goto("/app/notes")
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fnotes$/)
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).toHaveURL(/\/app\/notes$/)
})

test("two-factor: set up TOTP, sign in with a code, then with a backup code once", async ({ page, context }) => {
  await signInWithPassword(page, user, "/app/settings")
  await expect(page).toHaveURL(/\/app\/settings$/)

  await page.getByRole("button", { name: "Set up authenticator" }).click()
  await page.getByLabel("Confirm your password").fill(user.password)
  await page.getByRole("button", { name: "Continue" }).click()

  const secret = (await page.locator("p", { hasText: "Enter this key manually" }).locator("code").textContent())!.trim()
  expect(secret).toMatch(/^[A-Z2-7]+=*$/)
  await page.getByText("Backup codes", { exact: true }).click()
  const backupCodes = (await page.locator("details li").allTextContents()).map((c) => c.trim())
  expect(backupCodes.length).toBeGreaterThanOrEqual(8)

  await page.getByLabel("Code", { exact: true }).fill(totp(secret))
  await page.getByRole("button", { name: "Verify and turn on" }).click()
  await expect(page.getByText("Two-factor sign-in is on.")).toBeVisible()

  // Signed out, the password alone now stops at the code step.
  await context.clearCookies()
  await signInWithPassword(page, user)
  await expect(page).toHaveURL(/\/login\/mfa/)
  await page.getByLabel("Code").fill("000000" === totp(secret) ? "111111" : "000000")
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible()
  await page.getByLabel("Code").fill(totp(secret))
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).toHaveURL(/\/app$/)

  // A backup code works once.
  await context.clearCookies()
  await signInWithPassword(page, user)
  await expect(page).toHaveURL(/\/login\/mfa/)
  await page.getByLabel("Code").fill(backupCodes[0]!)
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).toHaveURL(/\/app$/)

  await context.clearCookies()
  await signInWithPassword(page, user)
  await expect(page).toHaveURL(/\/login\/mfa/)
  await page.getByLabel("Code").fill(backupCodes[0]!)
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible()
  await expect(page).toHaveURL(/\/login\/mfa/)
})
