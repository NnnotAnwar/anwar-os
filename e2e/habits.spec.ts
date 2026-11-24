// Habits: add one, tick it off on the Habits page and on Today, fix a day in
// the month grid, edit, archive with Undo, restore, the evening nudge switch,
// delete; and the same screen on a phone (tap targets, no sideways scroll).
import { randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { adminDb, expectNoHorizontalScroll, OWNER, ownerCredentials } from "./support"

test.use({ storageState: OWNER })

const run = randomBytes(3).toString("hex")
const stretch = `Stretch ${run}`
const admin = adminDb()

async function checks(name: string) {
  const [row] = await admin`
    select count(*)::int as n from habits_checks c join habits_habits h on h.id = c.habit_id where h.name = ${name}`
  return row!.n as number
}

/** Waits for hydration: before it a tap on a client button does nothing. */
async function open(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState("networkidle")
}

test.afterAll(async () => {
  await admin`delete from habits_habits where name like ${`%${run}%`}`
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  await admin`delete from habits_settings where owner_id = ${owner!.id as string}`
  await admin.end()
})

test("habits: add, tick off here and on Today, fix a day, edit, archive, restore, delete", async ({ page }) => {
  await open(page, "/app/habits?new=1")

  // ?new=1 opens the sheet (the page behind it is inert); every day is preselected.
  const sheet = page.getByRole("dialog", { name: "New habit" })
  await expect(sheet).toBeVisible()
  await sheet.getByLabel("Emoji").fill("🧘")
  await sheet.getByLabel("Name").fill(stretch)
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    await expect(sheet.getByRole("button", { name: day, exact: true })).toHaveAttribute("aria-pressed", "true")
  }
  await sheet.getByLabel("Reminder (optional)").fill("07:00")
  await sheet.getByRole("button", { name: "Add habit" }).click()
  await expect(page.getByText("Habit added")).toBeVisible()
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/\/app\/habits$/)
  await expect(page.getByRole("heading", { level: 1, name: "Habits" })).toBeVisible()

  const row = page.getByRole("list", { name: "Habits" }).getByRole("listitem").filter({ hasText: stretch })
  await expect(row).toContainText("Every day · reminder 07:00")

  // One tap ticks it off; the streak follows.
  const check = row.getByRole("checkbox", { name: `Done today: ${stretch}` })
  await check.click()
  await expect(check).toHaveAttribute("aria-checked", "true")
  await expect(row.getByLabel("1 day streak")).toBeVisible()
  await expect.poll(() => checks(stretch)).toBe(1)

  // Today shows it ticked; untick it there.
  await open(page, "/app")
  const widget = page.getByRole("list", { name: "Today's habits" })
  const todayCheck = widget.getByRole("checkbox", { name: `Done: ${stretch}` })
  await expect(todayCheck).toHaveAttribute("aria-checked", "true")
  await todayCheck.click()
  await expect(todayCheck).toHaveAttribute("aria-checked", "false")
  await expect.poll(() => checks(stretch)).toBe(0)

  // The habit's page: stats and the month grid, today marked.
  await widget.getByRole("link", { name: stretch }).click()
  await expect(page).toHaveURL(/\/app\/habits\/[0-9a-f-]{36}$/)
  await page.waitForLoadState("networkidle")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`🧘 ${stretch}`)
  const today = page.getByRole("list", { name: "Days" }).locator('[aria-current="date"]')
  await today.click()
  await expect(today).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => checks(stretch)).toBe(1)
  await expect(page.getByText("All time").locator("..")).toContainText("1")

  // Edit: weekdays only, no reminder.
  await page.getByRole("button", { name: "Edit" }).click()
  const edit = page.getByRole("dialog", { name: "Edit habit" })
  await edit.getByRole("button", { name: "Weekdays" }).click()
  await edit.getByRole("button", { name: "No reminder" }).click()
  await edit.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Habit saved")).toBeVisible()
  await expect(page.getByText("Weekdays", { exact: true })).toBeVisible()

  // Archive with Undo, then archive for real and restore from the list.
  await page.getByRole("button", { name: "Archive" }).click()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible()
  await page.getByRole("button", { name: "Archive" }).click()
  await expect(page.getByText("Archived habit")).toBeVisible()
  await open(page, "/app/habits?archived=1")
  await expect(page.getByRole("list", { name: "Habits" }).getByText(stretch)).toHaveCount(0)
  const archived = page.locator("details").filter({ hasText: "Archived" })
  await archived.getByRole("listitem").filter({ hasText: stretch }).getByRole("button", { name: "Restore" }).click()
  await expect(page.getByText(`${stretch} restored`)).toBeVisible()
  await expect(page.getByRole("list", { name: "Habits" }).getByText(stretch)).toBeVisible()

  // Delete asks first (the history goes too).
  await page.getByRole("list", { name: "Habits" }).getByRole("link", { name: stretch }).click()
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Delete habit" }).click()
  const confirm = page.getByRole("alertdialog")
  await expect(confirm).toContainText("Its whole history goes too (1 day done)")
  await confirm.getByRole("button", { name: "Delete" }).click()
  await expect(page).toHaveURL(/\/app\/habits$/)
  await expect(page.getByText(`${stretch} deleted`)).toBeVisible()
  const [left] = await admin`select count(*)::int as n from habits_habits where name = ${stretch}`
  expect(left!.n).toBe(0)
})

test("the evening nudge is off until switched on", async ({ page }) => {
  await open(page, "/app/habits")
  const nudge = page.getByRole("switch", { name: "Remind me in Telegram about habits still open" })
  await expect(nudge).not.toBeChecked()
  await expect(page.getByLabel("Evening nudge time")).toBeDisabled()
  await nudge.check()
  await expect(page.getByText("Evening nudge at 21:00")).toBeVisible()
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  await expect
    .poll(async () => (await admin`select nudge_enabled from habits_settings where owner_id = ${owner!.id as string}`)[0]?.nudge_enabled)
    .toBe(true)
  await nudge.uncheck()
  await expect(page.getByText("Evening nudge off")).toBeVisible()
})

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  })

  test("habits fit the screen and every target is thumb-sized", async ({ page }) => {
    const name = `Read a long chapter of a very good book every evening ${run}`
    const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
    await admin`insert into habits_habits (owner_id, name, emoji) values (${owner!.id as string}, ${name}, '📚')`

    await open(page, "/app/habits")
    const row = page.getByRole("list", { name: "Habits" }).getByRole("listitem").filter({ hasText: name })
    const check = row.getByRole("checkbox")
    expect((await check.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await check.tap()
    await expect(check).toHaveAttribute("aria-checked", "true")
    await expectNoHorizontalScroll(page)

    await page.getByRole("button", { name: "New habit" }).click()
    const sheet = page.getByRole("dialog", { name: "New habit" })
    for (const day of ["Mon", "Sun"]) {
      expect((await sheet.getByRole("button", { name: day, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    // 16px or more, or iOS zooms into the field.
    expect(await sheet.getByLabel("Name").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    await expectNoHorizontalScroll(page)
    await page.keyboard.press("Escape")

    await row.getByRole("link").click()
    await page.waitForLoadState("networkidle")
    const days = page.getByRole("list", { name: "Days" }).getByRole("button")
    expect((await days.first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expectNoHorizontalScroll(page)
  })
})
