// Offline mode: saved app pages open without a network, captures made offline
// wait on the device (IndexedDB outbox), survive a reload, and land exactly
// once when the connection returns. Production builds only (the service
// worker isn't registered by `next dev`).
import { randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { adminDb, OWNER } from "./support"

test.use({ storageState: OWNER })

async function productionOnly(page: Page) {
  const response = await page.goto("/app")
  test.skip(Boolean(response?.headers()["content-security-policy"]?.includes("'unsafe-eval'")), "production builds only")
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true)
}

/** Opens each page online while the worker controls the tab, so it saves a copy. */
async function visitOnline(page: Page, paths: string[]) {
  for (const path of paths) await page.goto(path, { waitUntil: "load" })
  await expect
    .poll(() =>
      page.evaluate(async (wanted) => {
        const cache = await caches.open("anwar-os-pages-v1")
        const saved = (await cache.keys()).map((r) => new URL(r.url).pathname)
        return wanted.every((p) => saved.includes(p))
      }, paths),
    )
    .toBe(true)
}

async function outboxSize(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("anwar-os-offline", 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("outbox")) return resolve(0)
          const count = db.transaction("outbox").objectStore("outbox").count()
          count.onsuccess = () => {
            resolve(count.result)
            db.close()
          }
        }
      }),
  )
}

test("captures made offline survive a reload and land once when back online", async ({ page, context }) => {
  await productionOnly(page)
  await visitOnline(page, ["/app/tasks", "/app/budget", "/app/notes/new", "/app/inbox"])
  const tag = randomBytes(4).toString("hex")
  const db = adminDb()

  try {
    await context.setOffline(true)

    // Inbox (the page's own capture field).
    await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(`Offline thought ${tag}`)
    await page.keyboard.press("Enter")
    await expect(page.getByText("Saved on this device · syncs when you're online")).toBeVisible()
    const waiting = page.getByRole("region", { name: "Waiting to sync" })
    await expect(waiting.getByText(`Offline thought ${tag}`)).toBeVisible()
    await expect(page.getByRole("button", { name: "1 waiting to sync" })).toBeVisible()

    // A task: the saved Tasks page opens offline, with the banner.
    await page.goto("/app/tasks")
    await expect(page.getByText(/Offline · showing saved copy from \d/)).toBeVisible()
    await page.locator("#quick-task").fill(`Offline task ${tag} tomorrow`)
    await page.keyboard.press("Enter")
    await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Waiting to sync" }).getByText(`Offline task ${tag} tomorrow`)).toBeVisible()

    // A quick expense.
    await page.goto("/app/budget")
    await page.locator("#quick-tx").fill(`250 e2e-${tag}`)
    await page.keyboard.press("Enter")
    await expect(page.getByRole("region", { name: "Waiting to sync" }).getByText(`250 e2e-${tag}`)).toBeVisible()

    // A new note: autosave keeps it on the device.
    await page.goto("/app/notes/new")
    await page.locator("#note-title").fill(`Offline note ${tag}`)
    await page.locator("#note-body").fill("Written without a connection.")
    await expect(page.getByText("Saved on this device · syncs when you're online")).toBeVisible()
    await expect(page.getByRole("button", { name: "4 waiting to sync" })).toBeVisible()

    // Reload while still offline: the page comes from the saved copy, the captures from IndexedDB.
    await page.goto("/app/inbox")
    await page.reload()
    await expect(page.getByText(/Offline · showing saved copy/)).toBeVisible()
    await expect(page.getByRole("region", { name: "Waiting to sync" }).getByText(`Offline thought ${tag}`)).toBeVisible()
    await expect(page.getByRole("button", { name: "4 waiting to sync" })).toBeVisible()
    expect(await outboxSize(page)).toBe(4)

    // Back online: everything syncs by itself, in order, once.
    await context.setOffline(false)
    await expect(page.getByRole("button", { name: /waiting to sync/ })).toHaveCount(0, { timeout: 20_000 })
    expect(await outboxSize(page)).toBe(0)
    // The saved copy was refreshed in place: live data, no banner.
    await expect(page.getByText(/saved copy/)).toHaveCount(0)

    // A second reload (and a second sync attempt) changes nothing.
    await page.reload()
    await page.waitForTimeout(1000)

    const [inbox] = await db`select count(*)::int as n from inbox_items where text = ${`Offline thought ${tag}`}`
    const [tasks] = await db`select count(*)::int as n, min(due_date)::text as due from tasks_tasks where title = ${`Offline task ${tag}`}`
    const [notes] = await db`select count(*)::int as n from notes_notes where title = ${`Offline note ${tag}`} and body = 'Written without a connection.'`
    const [spent] = await db`select count(*)::int as n, min(amount_minor)::int as amount from budget_transactions where note = ${`e2e-${tag}`}`
    expect(inbox!.n).toBe(1)
    expect(tasks!.n).toBe(1)
    expect(tasks!.due).not.toBeNull()
    expect(notes!.n).toBe(1)
    expect(spent).toEqual({ n: 1, amount: -25000 })
  } finally {
    await context.setOffline(false)
    await db`delete from budget_transactions where note = ${`e2e-${tag}`}`
    await db`delete from inbox_items where text like ${`%${tag}%`}`
    await db`delete from tasks_tasks where title like ${`%${tag}%`}`
    await db`delete from notes_notes where title like ${`%${tag}%`}`
    await db.end()
  }
})

test("a capture whose Server Action can't get through goes through the sync API instead", async ({ page }) => {
  await productionOnly(page)
  await page.goto("/app/inbox")
  // Before hydration Enter submits the form natively (no Next-Action header), so wait.
  await page.waitForLoadState("networkidle")
  const tag = randomBytes(4).toString("hex")
  // A deploy changed the action ids, or the request died on the way: the action call fails.
  await page.route("**/app/inbox**", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("failed") : route.fallback(),
  )
  const db = adminDb()
  try {
    await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(`Skewed ${tag}`)
    await page.keyboard.press("Enter")
    await expect(page.getByText("Captured", { exact: true })).toBeVisible()
    await expect.poll(async () => (await db`select count(*)::int as n from inbox_items where text = ${`Skewed ${tag}`}`)[0]!.n).toBe(1)
    expect(await outboxSize(page)).toBe(0)
  } finally {
    await db`delete from inbox_items where text like ${`%${tag}%`}`
    await db.end()
  }
})

test("signing out with captures still waiting asks first, then clears this device", async ({ page, context }) => {
  await productionOnly(page)
  await visitOnline(page, ["/app/inbox"])
  const tag = randomBytes(4).toString("hex")

  await context.setOffline(true)
  await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(`Not synced yet ${tag}`)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "1 waiting to sync" })).toBeVisible()
  // Keep it waiting once back online: the sync API is down.
  await page.route("**/api/sync/**", (route) => route.fulfill({ status: 503, body: "" }))
  // The shared owner session must survive this spec: the sign-out request itself never leaves.
  await page.route("**/app/**", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("failed") : route.fallback(),
  )
  await context.setOffline(false)

  const menu = page.getByRole("button", { name: "Account and appearance" })
  await menu.click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByText("1 capture hasn't synced")).toBeVisible()
  await dialog.getByRole("button", { name: "Stay signed in" }).click()
  await expect(dialog).toBeHidden()
  expect(await outboxSize(page)).toBe(1)

  await menu.click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign out and delete" }).click()
  await expect(page.getByText("Couldn't sign out. Check your connection and try again.")).toBeVisible()
  expect(await outboxSize(page)).toBe(0)
  const pages = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("anwar-os-pages-")))
  expect(pages).toEqual([])
  await expect(page.getByRole("button", { name: /waiting to sync/ })).toHaveCount(0)
})

test("updating the service worker drops the previous version's caches and keeps the outbox", async ({ page }) => {
  // The public site doesn't register the worker: set the scene there, as the
  // version before this one left it (its shell cache, its unversioned asset
  // cache), plus a capture waiting in the outbox.
  const response = await page.goto("/")
  test.skip(Boolean(response?.headers()["content-security-policy"]?.includes("'unsafe-eval'")), "production builds only")
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  await page.evaluate(async () => {
    await (await caches.open("anwar-os-shell-v1")).put("/offline.html", new Response("old offline page"))
    await (await caches.open("anwar-os-static")).put("/_next/static/old.js", new Response("old chunk"))
    await (await caches.open("anwar-os-pages-v0")).put("/app", new Response("old page"))
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("anwar-os-offline", 1)
      open.onupgradeneeded = () => open.result.createObjectStore("outbox", { keyPath: "id" }).createIndex("seq", "seq")
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const tx = open.result.transaction("outbox", "readwrite")
        // Another account's capture: never sent under this session, so it just stays.
        tx.objectStore("outbox").put({
          id: crypto.randomUUID(),
          kind: "inbox",
          payload: { text: "kept across the update" },
          userId: "someone-else",
          capturedAt: new Date().toISOString(),
          seq: Date.now() * 1000,
          status: "pending",
          attempts: 0,
          error: null,
          lastAttemptAt: null,
        })
        tx.oncomplete = () => {
          open.result.close()
          resolve()
        }
      }
    })
  })

  // Opening the app installs and activates this version.
  await page.goto("/app")
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true)
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("anwar-os-")).sort()))
    .toEqual(expect.arrayContaining(["anwar-os-pages-v1", "anwar-os-shell-v2"]))
  const names = await page.evaluate(async () => caches.keys())
  expect(names).not.toContain("anwar-os-shell-v1")
  expect(names).not.toContain("anwar-os-static")
  expect(names).not.toContain("anwar-os-pages-v0")
  expect(await page.evaluate(async () => (await (await caches.match("/offline.html"))?.text()) ?? "")).toContain("You're offline")
  expect(await outboxSize(page)).toBe(1)

  // And the app works offline on it.
  await visitOnline(page, ["/app/inbox"])
  await page.context().setOffline(true)
  try {
    await page.reload()
    await expect(page.getByText(/Offline · showing saved copy/)).toBeVisible()
  } finally {
    await page.context().setOffline(false)
  }
})
