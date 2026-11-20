// 375 px phone (touch, Android UA): no page scrolls sideways, and Today offers
// to install the app until dismissed, which is remembered on this device.
import { expect, test } from "@playwright/test"
import { expectNoHorizontalScroll, OWNER } from "./support"

const publicPages = ["/", "/projects", "/ideas", "/links", "/cv", "/tools", "/tools/calculator", "/feedback", "/login"]
const privatePages = ["/app", "/app/services", "/app/notes", "/app/notes/new", "/app/links", "/app/ideas", "/app/inbox", "/app/calendar", "/app/feedback", "/app/settings", "/app/capture"]

for (const path of publicPages) {
  test(`${path} fits 375 px`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    await expectNoHorizontalScroll(page)
  })
}

test.describe("signed in", () => {
  test.use({ storageState: OWNER })

  for (const path of privatePages) {
    test(`${path} fits 375 px`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.locator("main")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await expectNoHorizontalScroll(page)
    })
  }

  test("Today offers to install the app until dismissed", async ({ page }) => {
    await page.goto("/app")
    const hint = page.getByRole("region", { name: "Install anwar.os" })
    await expect(hint).toBeVisible()
    await expect(hint).toContainText(/Install app|Add to Home screen|home screen/)
    await page.getByRole("button", { name: "Hide the install hint" }).click()
    await expect(hint).toBeHidden()
    await page.reload()
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    await expect(page.getByRole("region", { name: "Install anwar.os" })).toHaveCount(0)
  })
})
