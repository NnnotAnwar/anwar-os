// Signs the owner in once and saves the session for the specs that need it.
import { expect, test as setup } from "@playwright/test"
import { OWNER, ownerCredentials, signInWithPassword } from "./support"

setup("sign in as the owner", async ({ page }) => {
  await signInWithPassword(page, ownerCredentials())
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await page.context().storageState({ path: OWNER })
})
