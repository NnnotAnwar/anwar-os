// The installable app: manifest and icons, the service worker and its offline
// page, and the share target (/app/capture) saving into the inbox or a module.
import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { OWNER } from "./support"

test.use({ storageState: OWNER })

test("the manifest makes it installable and points sharing at Capture", async ({ page, request }) => {
  await page.goto("/app")
  const href = await page.locator('link[rel="manifest"]').getAttribute("href")
  expect(href).toBe("/manifest.webmanifest")

  const manifest = await (await request.get(href!)).json()
  expect(manifest).toMatchObject({
    name: "anwar.os",
    short_name: "anwar.os",
    start_url: "/app",
    display: "standalone",
    share_target: { action: "/app/capture", method: "GET", params: { title: "title", text: "text", url: "url" } },
  })
  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose)
  expect(purposes).toEqual(expect.arrayContaining(["any", "maskable"]))
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src)
    expect(response.status(), icon.src).toBe(200)
  }
  expect((await request.get("/apple-icon.png")).status()).toBe(200)
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
  await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]')).not.toHaveCount(0)
})

test("the service worker shows the offline page and never caches pages or data", async ({ page, context }) => {
  await page.goto("/app")
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname)
    }
    return urls
  })
  expect(cached).toContain("/offline.html")
  for (const path of cached) expect(path).toMatch(/^\/(offline\.html|icons\/|_next\/static\/)/)

  await context.setOffline(true)
  await page.goto("/app/notes").catch(() => {})
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible()
  await context.setOffline(false)
  await page.getByRole("link", { name: "Try again" }).click()
  await expect(page).toHaveURL(/\/app$/)
})

test("a shared link lands in the inbox by default", async ({ page }) => {
  const title = `Shared ${randomBytes(3).toString("hex")}`
  const params = new URLSearchParams({ title, text: "Worth reading https://example.com/article" })
  await page.goto(`/app/capture?${params}`)

  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title)
  await expect(page.getByRole("textbox", { name: "Link" })).toHaveValue("https://example.com/article")
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue("Worth reading")
  await expect(page.getByRole("radio", { name: "Inbox" })).toBeChecked()

  await page.getByRole("button", { name: "Save to Inbox" }).click()
  await expect(page).toHaveURL(/\/app\/inbox/)
  await expect(page.getByText("Saved to Inbox.")).toBeVisible()
  await expect(page.getByText(title).first()).toBeVisible()
})

test("capture can save straight into a module instead", async ({ page }) => {
  const title = `Captured note ${randomBytes(3).toString("hex")}`
  await page.goto(`/app/capture?${new URLSearchParams({ title, text: "From the share sheet" })}`)
  await page.getByRole("group", { name: "Save to" }).getByText("Note").click()
  await page.getByRole("button", { name: "Save to Note" }).click()
  await expect(page).toHaveURL(/\/app\/notes\/[0-9a-f-]{36}$/)
  await expect(page.locator("#note-title")).toHaveValue(title)
  await expect(page.getByRole("article").getByText("From the share sheet")).toBeVisible()

  // A link needs an address.
  await page.goto("/app/capture")
  await page.getByRole("group", { name: "Save to" }).getByText("Link").click()
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("no address here")
  await page.getByRole("button", { name: "Save to Link" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Add the link's address" })).toBeVisible()
})
