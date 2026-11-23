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

  // A notched iPhone in the home-screen app: 47 px status bar, 34 px home
  // indicator (emulated through CDP; iOS only reports them with viewport-fit=cover).
  test("the tab bar and header clear the safe areas", async ({ page }) => {
    const insets = { top: 47, bottom: 34 }
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets })
    await page.goto("/app")
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/)

    const tabs = page.getByRole("navigation", { name: "Main" }).filter({ visible: true })
    await expect(tabs.getByRole("link")).toHaveCount(4)
    const viewportHeight = page.viewportSize()!.height
    const bar = (await tabs.boundingBox())!
    expect(bar.y + bar.height).toBeCloseTo(viewportHeight, 0)
    for (const link of await tabs.getByRole("link").all()) {
      const box = (await link.boundingBox())!
      expect(box.y + box.height, "tab sits above the home indicator").toBeLessThanOrEqual(viewportHeight - insets.bottom + 0.5)
      expect(box.height, "tab is a comfortable tap target").toBeGreaterThanOrEqual(44)
    }

    const wordmark = (await page.getByRole("banner").getByRole("link", { name: "anwar.os" }).boundingBox())!
    expect(wordmark.y, "header content sits below the status bar").toBeGreaterThanOrEqual(insets.top)

    // The end of the page scrolls clear of the bar.
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const lastBottom = await page.evaluate(() => document.querySelector("main")!.lastElementChild!.getBoundingClientRect().bottom)
    const barTop = (await tabs.boundingBox())!.y
    expect(lastBottom, "last content ends above the tab bar").toBeLessThanOrEqual(barTop)
  })

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
