// Cookie-free analytics: a visitor's page view is counted from the beacon
// (POST /api/a → app.record_page_view()); Do Not Track and the signed-in owner
// are not; the owner's dashboard and Today widget show the counts.
import { expect, test, type Page } from "@playwright/test"
import { adminDb, OWNER } from "./support"

const anonymous = { storageState: { cookies: [], origins: [] } }

async function cvViews() {
  const admin = adminDb()
  try {
    const [row] = await admin<{ n: number }[]>`
      select coalesce(sum(views), 0)::int as n from analytics_daily
       where path = '/cv' and day = (now() at time zone 'utc')::date`
    return row!.n
  } finally {
    await admin.end()
  }
}

/** Opens /cv and waits for its beacon to be answered. */
async function visitCv(page: Page) {
  const beacon = page.waitForResponse((r) => r.url().endsWith("/api/a") && r.request().method() === "POST")
  await page.goto("/cv")
  const response = await beacon
  expect(response.status()).toBe(204)
  // The beacon sends no cookies to the visitor.
  expect(response.headers()["set-cookie"]).toBeUndefined()
}

test("a visitor's page view is counted, without cookies", async ({ browser }) => {
  const before = await cvViews()
  const context = await browser.newContext(anonymous)
  const page = await context.newPage()
  await visitCv(page)
  await expect.poll(cvViews).toBe(before + 1)
  expect(await context.cookies()).toEqual([])
  await context.close()
})

test("Do Not Track and the signed-in owner are not counted", async ({ browser }) => {
  const dnt = await browser.newContext({ ...anonymous, extraHTTPHeaders: { DNT: "1" } })
  const owner = await browser.newContext({ storageState: OWNER })
  const before = await cvViews()
  for (const context of [dnt, owner]) {
    const page = await context.newPage()
    // With DNT the page may not send a beacon at all; either way nothing is counted.
    await page.goto("/cv")
    await page.waitForLoadState("networkidle")
  }
  expect(await cvViews()).toBe(before)
  await Promise.all([dnt.close(), owner.close()])
})

test.describe("the owner", () => {
  test.use({ storageState: OWNER })

  test("sees the views on the dashboard and on Today", async ({ page, browser }) => {
    // Make sure there's at least one view to show.
    const visitor = await browser.newContext(anonymous)
    await visitCv(await visitor.newPage())
    await visitor.close()

    await page.goto("/app/analytics?range=7")
    await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("heading", { name: "Views, last 7 days" })).toBeVisible()
    const topPages = page.locator("section").filter({ has: page.getByRole("heading", { name: "Top pages" }) })
    await expect(topPages.getByRole("link", { name: "CV" })).toBeVisible()

    await page.goto("/app")
    const widget = page.locator("section").filter({ has: page.getByRole("heading", { name: "Site views this week" }) })
    await expect(widget.getByText(/views?/).first()).toBeVisible()
  })
})
