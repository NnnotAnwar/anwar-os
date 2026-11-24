// Publishing a note: one tap in the editor puts it on /writing, its page and
// the feeds (absolute URLs from the runtime origin); unpublishing takes it off
// everywhere on the next request.
import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { OWNER } from "./support"

test.use({ storageState: OWNER })

test("publish a note, find it on /writing and in the feeds, then take it down", async ({ page, browser, baseURL }) => {
  const tag = randomBytes(3).toString("hex")
  const title = `E2E writing ${tag}`
  await page.goto("/app/notes/new")
  await page.locator("#note-title").fill(title)
  const body = page.locator("#note-body")
  await body.click()
  await body.pressSequentially("Published from the notes editor. See the [CV](/cv).")
  await expect(page).toHaveURL(/\/app\/notes\/[0-9a-f-]{36}$/)
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible()

  const toggle = page.getByRole("switch", { name: "Publish on /writing" })
  await toggle.check()
  await expect(page.getByText("Published on /writing", { exact: true })).toBeVisible()
  // The first publish refreshes the route, which swaps /app/notes/new for the
  // note's own page (the old one stays mounted, hidden; roles skip it).
  const address = page.getByRole("textbox", { name: "Address" })
  await expect(address).toHaveValue(`e2e-writing-${tag}`)
  const slug = await address.inputValue()

  // A visitor, with no session.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const v = await visitor.newPage()
  await v.goto("/writing")
  await expect(v.getByRole("heading", { name: "Notes, written up", level: 1 })).toBeVisible()
  await v.getByRole("link", { name: new RegExp(title) }).click()
  await expect(v).toHaveURL(new RegExp(`/writing/${slug}$`))
  await expect(v.getByRole("heading", { name: title, level: 1 })).toBeVisible()
  await expect(v.getByRole("article").getByText(/1 min read/)).toBeVisible()
  // The head advertises the feed and a canonical URL on the runtime origin.
  await expect(v.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute("href", /\/writing\/feed\.xml$/)
  await expect(v.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/writing/${slug}`)

  for (const path of ["/writing/feed.xml", "/feed.xml"]) {
    const rss = await v.request.get(path)
    expect(rss.status(), path).toBe(200)
    expect(rss.headers()["content-type"]).toContain("application/rss+xml")
    const xml = await rss.text()
    expect(xml).toContain(`<title>${title}</title>`)
    expect(xml).toContain(`<link>${baseURL}/writing/${slug}</link>`)
    expect(xml).toContain(`href="${baseURL}/cv"`)
  }
  const atom = await v.request.get("/writing/atom.xml")
  expect(await atom.text()).toContain(`<id>${baseURL}/writing/${slug}</id>`)

  // Take it down: gone from the list, the page and the feed on the next request.
  await toggle.uncheck()
  await expect(page.getByText("Taken off /writing", { exact: true })).toBeVisible()
  await v.goto("/writing")
  await expect(v.getByRole("heading", { name: "Notes, written up", level: 1 })).toBeVisible()
  await expect(v.getByText(title)).toHaveCount(0)
  await v.goto(`/writing/${slug}`)
  await expect(v.getByRole("heading", { name: "This page isn't here", level: 1 })).toBeVisible()
  expect(await (await v.request.get("/writing/feed.xml")).text()).not.toContain(title)
  await visitor.close()
})
