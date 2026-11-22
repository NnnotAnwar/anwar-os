// Public pages render for visitors, under the nonce CSP, with nothing blocked.
import { expect, test } from "@playwright/test"
import { OWNER, watchCsp } from "./support"

const publicPages = ["/", "/projects", "/ideas", "/links", "/cv", "/tools", "/tools/calculator", "/feedback", "/login"]

for (const path of publicPages) {
  test(`${path} renders with no CSP violations`, async ({ page }) => {
    const violations = await watchCsp(page)
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await violations()).toEqual([])
  })
}

test("every HTML response carries a fresh nonce CSP that the scripts use", async ({ request }) => {
  const a = await request.get("/projects")
  const b = await request.get("/projects")
  const csp = a.headers()["content-security-policy"]!
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)

  const nonce = csp.match(/'nonce-([^']+)'/)![1]!
  expect(b.headers()["content-security-policy"]).not.toContain(nonce)
  const html = await a.text()
  const scripts = html.match(/<script\b[^>]*>/g) ?? []
  expect(scripts.length).toBeGreaterThan(0)
  for (const tag of scripts) expect(tag, tag).toContain(`nonce="${nonce}"`)
})

test("an unknown address gets the site's own 404, inside the public frame", async ({ page, request }) => {
  const response = await page.goto("/no-such-page")
  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { name: "This page isn't here", level: 1 })).toBeVisible()
  await expect(page.getByRole("link", { name: "Go to the start" })).toBeVisible()
  // Real routes and files stay more specific than the catch-all.
  for (const path of ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/sw.js", "/api/health"]) {
    expect((await request.get(path)).status(), path).toBe(200)
  }
})

test.describe("signed in", () => {
  test.use({ storageState: OWNER })

  for (const path of ["/app", "/app/services", "/app/notes", "/app/settings", "/app/capture"]) {
    test(`${path} renders with no CSP violations`, async ({ page }) => {
      const violations = await watchCsp(page)
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(await violations()).toEqual([])
    })
  }

  test("an unknown /app address gets the app's 404, inside the shell", async ({ page }) => {
    // 200, like every notFound() under /app: the shell streams first (noindex is still set).
    await page.goto("/app/no-such-service")
    await expect(page.getByRole("heading", { name: "Nothing lives at this address", level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go to Today" })).toBeVisible()
  })

  test("client navigation keeps working under the CSP", async ({ page }) => {
    const violations = await watchCsp(page)
    await page.goto("/app")
    await page.getByRole("link", { name: "Services" }).first().click()
    await expect(page).toHaveURL(/\/app\/services$/)
    await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible()
    expect(await violations()).toEqual([])
  })
})
