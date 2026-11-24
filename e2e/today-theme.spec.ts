// Edit Today (reorder, hide, undo, reset; drag, keys and buttons; phone) and
// the appearance: a fixed theme is in the HTML itself, a schedule is applied by
// the pre-paint script before any of the app's JavaScript runs, it switches live
// at the boundary, and the owner's choice follows them to the public site.
import { expect, test, type Locator, type Page } from "@playwright/test"
import { adminDb, expectNoHorizontalScroll, OWNER, ownerCredentials, watchCsp } from "./support"

test.use({ storageState: OWNER, timezoneId: "Europe/Prague" })

const admin = adminDb()
let ownerId = ""

async function resetPreferences() {
  await admin`
    update core_preferences
    set theme_mode = 'system', theme_schedule = 'hours', theme_dark_from = '20:00', theme_dark_until = '07:00',
        theme_lat = null, theme_lon = null, theme_place = null, today_order = '{}', today_hidden = '{}'
    where owner_id = ${ownerId}`
}

test.beforeAll(async () => {
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  ownerId = owner!.id as string
  await resetPreferences()
})

test.afterAll(async () => {
  await resetPreferences()
  await admin.end()
})

async function openToday(page: Page) {
  await page.goto("/app")
  await expect(page.getByRole("heading", { name: "At a glance" })).toBeVisible()
  await page.waitForLoadState("networkidle")
}

function widgetKeys(page: Page) {
  return page.locator("[data-widget]").evaluateAll((els) => els.map((el) => el.getAttribute("data-widget")!))
}

async function openEditor(page: Page) {
  await page.getByRole("button", { name: "Edit Today" }).click()
  const dialog = page.getByRole("dialog", { name: "Edit Today" })
  await expect(dialog).toBeVisible()
  // Wait until the sheet has finished sliding in (actionable = stable), so measured boxes hold.
  await dialog.getByRole("button", { name: "Cancel" }).click({ trial: true })
  return dialog
}

function rowTitles(dialog: Locator) {
  return dialog.getByRole("listitem").evaluateAll((els) => els.map((el) => el.querySelector("span span")!.textContent!))
}

test.describe("Edit Today", () => {
  test.beforeEach(resetPreferences)

  test("reorder and hide with the buttons, keep it after a reload, undo, reset", async ({ page }) => {
    await openToday(page)
    const before = await widgetKeys(page)
    expect(before.length).toBeGreaterThanOrEqual(4)

    const dialog = await openEditor(page)
    await expect(dialog.getByRole("listitem")).toHaveCount(before.length)
    const titles = await rowTitles(dialog)
    // The second moves up; the third is switched off.
    await dialog.getByRole("button", { name: `Move ${titles[1]} up` }).click()
    await expect(dialog.getByRole("status").or(dialog.locator("[aria-live]")).first()).toContainText(`${titles[1]}: position 1`)
    await dialog.getByRole("switch", { name: `Show ${titles[2]}` }).uncheck()
    await expect(dialog).toContainText(`${before.length - 1} of ${before.length} shown`)
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog).toBeHidden()

    const expected = [before[1], before[0], ...before.slice(3)]
    await expect.poll(() => widgetKeys(page)).toEqual(expected)
    await page.reload()
    await expect.poll(() => widgetKeys(page)).toEqual(expected)

    // Hidden widgets keep their place in the editor, switched off.
    const again = await openEditor(page)
    expect(await rowTitles(again)).toEqual([titles[1], titles[0], ...titles.slice(2)])
    await expect(again.getByRole("switch", { name: `Show ${titles[2]}` })).not.toBeChecked()

    // Keyboard on the handle: End sends the first widget to the bottom.
    await again.getByRole("button", { name: `Move ${titles[1]}`, exact: true }).focus()
    await page.keyboard.press("End")
    await page.keyboard.press("ArrowUp")
    await again.getByRole("button", { name: "Save" }).click()
    const moved = [before[0], ...before.slice(3, -1), before[1], before.at(-1)]
    await expect.poll(() => widgetKeys(page)).toEqual(moved)

    // Undo restores the layout before this save.
    await page.getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => widgetKeys(page)).toEqual(expected)

    // Reset: every widget, in the modules' order.
    const last = await openEditor(page)
    await last.getByRole("button", { name: "Reset to default" }).click()
    await expect(last.getByRole("button", { name: "Reset to default" })).toBeDisabled()
    await last.getByRole("button", { name: "Save" }).click()
    await expect.poll(() => widgetKeys(page)).toEqual(before)
    const [row] = await admin`select today_order, today_hidden from core_preferences where owner_id = ${ownerId}`
    expect(row).toEqual({ today_order: [], today_hidden: [] })
  })

  test("drag a widget by its handle; Cancel keeps Today as it was", async ({ page }) => {
    await openToday(page)
    const before = await widgetKeys(page)
    const dialog = await openEditor(page)
    const titles = await rowTitles(dialog)

    const handle = dialog.getByRole("button", { name: `Move ${titles[0]}`, exact: true })
    // The list can be taller than the window: bring its top into view.
    await handle.scrollIntoViewIfNeeded()
    const third = (await dialog.getByRole("listitem").nth(2).boundingBox())!
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // Past the middle of the third row: two slots down.
    for (let y = box.y; y <= third.y + third.height * 0.75; y += 8) await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.up()
    await expect.poll(() => rowTitles(dialog)).toEqual([titles[1], titles[2], titles[0], ...titles.slice(3)])

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    expect(await widgetKeys(page)).toEqual(before)
    // Reopening starts from what's saved.
    expect(await rowTitles(await openEditor(page))).toEqual(titles)
  })

  test("everything hidden says how to get widgets back", async ({ page }) => {
    await openToday(page)
    const keys = await widgetKeys(page)
    await admin`update core_preferences set today_hidden = ${keys} where owner_id = ${ownerId}`
    await admin`
      insert into core_preferences (owner_id, today_hidden) values (${ownerId}, ${keys})
      on conflict (owner_id) do nothing`
    await page.reload()
    await expect(page.getByText("Every widget is hidden. Edit Today to bring some back.")).toBeVisible()
    expect(await widgetKeys(page)).toEqual([])
  })
})

test.describe("Edit Today on a phone", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  })
  test.beforeEach(resetPreferences)

  test("comfortable controls, no sideways scroll, saves", async ({ page }) => {
    await openToday(page)
    const before = await widgetKeys(page)
    const dialog = await openEditor(page)
    const titles = await rowTitles(dialog)
    const row = dialog.getByRole("listitem").nth(1)
    for (const control of [
      row.getByRole("button", { name: `Move ${titles[1]}`, exact: true }),
      row.getByRole("button", { name: `Move ${titles[1]} up` }),
      row.getByRole("button", { name: `Move ${titles[1]} down` }),
    ]) {
      const box = (await control.boundingBox())!
      // 44 CSS px; boxes come back as 43.99997 at 3x.
      expect(Math.min(box.width, box.height), "tap target").toBeGreaterThanOrEqual(43.9)
    }
    expect((await row.locator("label").boundingBox())!.height).toBeGreaterThanOrEqual(43.9)
    await expectNoHorizontalScroll(page)

    await row.getByRole("button", { name: `Move ${titles[1]} down` }).tap()
    await dialog.getByRole("switch", { name: `Show ${titles[0]}` }).tap()
    await dialog.getByRole("button", { name: "Save" }).tap()
    await expect(dialog).toBeHidden()
    await expect.poll(() => widgetKeys(page)).toEqual([before[2], before[1], ...before.slice(3)])
  })

  test("drag with a finger", async ({ page }) => {
    await openToday(page)
    const dialog = await openEditor(page)
    const titles = await rowTitles(dialog)
    // The sheet scrolls on a phone: bring the top of the list into view first.
    const handleButton = dialog.getByRole("button", { name: `Move ${titles[0]}`, exact: true })
    await handleButton.scrollIntoViewIfNeeded()
    const handle = (await handleButton.boundingBox())!
    const third = (await dialog.getByRole("listitem").nth(2).boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    const x = handle.x + handle.width / 2
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: handle.y + handle.height / 2 }] })
    for (let y = handle.y + handle.height / 2; y <= third.y + third.height * 0.75; y += 6) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] })
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect.poll(() => rowTitles(dialog)).toEqual([titles[1], titles[2], titles[0], ...titles.slice(3)])
    await dialog.getByRole("button", { name: "Cancel" }).tap()
  })
})

/** The <html> class and color-scheme as the server sent them, before any script. */
async function serverHtml(page: Page, path: string) {
  const html = await (await page.request.get(path)).text()
  return html.match(/<html[^>]*>/)![0]
}

/** Loads a page with the app's own JavaScript blocked: only the inline pre-paint script runs. */
async function withoutAppScripts(page: Page, path: string) {
  await page.route(/\/_next\/static\/.*\.js/, (route) => route.abort())
  await page.goto(path)
  const state = await page.evaluate(() => ({
    classes: [...document.documentElement.classList].filter((c) => c === "dark" || c === "light"),
    colorScheme: document.documentElement.style.colorScheme,
  }))
  await page.unroute(/\/_next\/static\/.*\.js/)
  return state
}

test.describe("appearance", () => {
  test.beforeEach(resetPreferences)

  test("Dark is in the HTML itself, on the app and the owner's public site; visitors keep the system's", async ({
    page,
    browser,
  }) => {
    const violations = await watchCsp(page)
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/app/settings")
    await page.getByRole("radio", { name: /^Dark/ }).check({ force: true })
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    await expect.poll(async () => (await admin`select theme_mode from core_preferences where owner_id = ${ownerId}`)[0]?.theme_mode).toBe("dark")

    expect(await serverHtml(page, "/app")).toMatch(/class="[^"]*\bdark\b[^"]*"[^>]*style="color-scheme:\s*dark/)
    expect(await serverHtml(page, "/")).toMatch(/class="[^"]*\bdark\b/)
    await page.goto("/")
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    expect(await violations()).toEqual([])

    for (const colorScheme of ["light", "dark"] as const) {
      const visitor = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        storageState: { cookies: [], origins: [] },
        colorScheme,
      })
      const p = await visitor.newPage()
      await p.goto("/")
      await expect(p.locator("html")).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
      expect(await serverHtml(p, "/")).not.toMatch(/class="[^"]*\b(dark|light)\b/)
      await visitor.close()
    }
  })

  test("a new device catches up with the saved theme, then has it before paint", async ({ page }) => {
    await admin`update core_preferences set theme_mode = 'dark' where owner_id = ${ownerId}`
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/app")
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === "aos-theme")?.value).toMatch(/^dark/)
    expect(await serverHtml(page, "/app")).toMatch(/class="[^"]*\bdark\b/)
  })

  test("Scheduled (fixed hours): set before the app's scripts run, and switches live at the boundary", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/app/settings")
    const schedule = page.getByRole("region", { name: "Schedule" })
    await schedule.getByRole("radio", { name: "Fixed hours" }).check({ force: true })
    await schedule.getByLabel("Dark from").fill("20:00")
    await schedule.getByLabel("Light from").fill("07:00")
    await expect(schedule).toContainText("Dark 20:00–07:00")
    await schedule.getByRole("button", { name: "Save schedule" }).click()
    await expect(page.getByRole("radio", { name: /^Scheduled/ })).toBeChecked()

    // 23:00 in Prague, system light: dark, from the inline script alone.
    await page.clock.setFixedTime("2026-11-24T22:00:00Z")
    expect(await withoutAppScripts(page, "/app")).toEqual({ classes: ["dark"], colorScheme: "dark" })
    // Noon: light, even with a dark system.
    await page.emulateMedia({ colorScheme: "dark" })
    await page.clock.setFixedTime("2026-11-24T11:00:00Z")
    expect(await withoutAppScripts(page, "/app")).toEqual({ classes: ["light"], colorScheme: "light" })
  })

  test("Scheduled switches while the app is open", async ({ page }) => {
    await admin`
      insert into core_preferences (owner_id, theme_mode) values (${ownerId}, 'scheduled')
      on conflict (owner_id) do update set theme_mode = 'scheduled', theme_schedule = 'hours',
        theme_dark_from = '20:00', theme_dark_until = '07:00'`
    await page.emulateMedia({ colorScheme: "light" })
    // 19:59:00 in Prague.
    await page.clock.install({ time: new Date("2026-11-24T18:59:00Z") })
    await page.goto("/app")
    await expect(page.getByRole("heading", { name: "At a glance" })).toBeVisible()
    await expect(page.locator("html")).toHaveClass(/\blight\b/)
    await page.clock.runFor(90_000)
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    await expect(page.locator("html")).not.toHaveClass(/\blight\b/)
  })

  test("Sunset to sunrise in Prague, from the built-in city list", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/app/settings")
    const schedule = page.getByRole("region", { name: "Schedule" })
    await schedule.getByRole("radio", { name: "Sunset to sunrise" }).check({ force: true })
    await schedule.getByLabel("Place").fill("Atlantis")
    await expect(schedule).toContainText("Pick a city from the list")
    await expect(schedule.getByRole("button", { name: "Save schedule" })).toBeDisabled()
    await schedule.getByLabel("Place").fill("prague")
    await expect(schedule).toContainText(/Dark after sunset \d\d:\d\d, light from sunrise \d\d:\d\d/)
    await schedule.getByRole("button", { name: "Save schedule" }).click()
    await expect.poll(async () => (await admin`select theme_schedule, theme_lat, theme_lon, theme_place from core_preferences where owner_id = ${ownerId}`)[0]).toEqual({
      theme_schedule: "sun",
      theme_lat: 50.1,
      theme_lon: 14.4,
      theme_place: "Prague",
    })

    // 17:00 in Prague in late November is after sunset (≈16:05); 12:00 is day.
    await page.clock.setFixedTime("2026-11-24T16:00:00Z")
    expect(await withoutAppScripts(page, "/app")).toEqual({ classes: ["dark"], colorScheme: "dark" })
    await page.clock.setFixedTime("2026-11-24T11:00:00Z")
    expect(await withoutAppScripts(page, "/app")).toEqual({ classes: ["light"], colorScheme: "light" })
  })

  test("the account menu offers Scheduled and links to its settings", async ({ page }) => {
    await page.goto("/app")
    await page.getByRole("button", { name: "Account and appearance" }).first().click()
    await page.getByRole("menuitemradio", { name: /Scheduled/ }).click()
    await expect.poll(async () => (await admin`select theme_mode from core_preferences where owner_id = ${ownerId}`)[0]?.theme_mode).toBe("scheduled")
    // The menu stays open on a radio choice, showing it.
    await expect(page.getByRole("menuitemradio", { name: /Scheduled/ })).toBeChecked()
    await page.getByRole("menuitem", { name: "Schedule settings…" }).click()
    await expect(page).toHaveURL(/\/app\/settings#appearance$/)
  })
})
