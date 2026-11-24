// Global search: ⌘K on the desktop and the full-screen search sheet on a phone.
// Fixtures (a note, a task and a Budget expense carrying a unique word) are
// inserted for the seeded owner through MIGRATION_DATABASE_URL and removed after.
import { randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { adminDb, expectNoHorizontalScroll, OWNER, ownerCredentials } from "./support"

const word = `zebra${randomBytes(3).toString("hex")}`
const admin = adminDb()
let noteId = ""
let txId = ""

test.beforeAll(async () => {
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  const ownerId = owner!.id as string
  const [note] = await admin`
    insert into notes_notes (owner_id, title, body)
    values (${ownerId}, ${`Trip ${word}`}, 'Pack the tent') returning id`
  noteId = note!.id
  // Overview shows five per service: six notes make "See all" appear.
  for (let i = 1; i <= 5; i++) {
    await admin`insert into notes_notes (owner_id, title, body) values (${ownerId}, ${`Other ${i}`}, ${`mentions ${word} inside`})`
  }
  await admin`insert into tasks_tasks (owner_id, title) values (${ownerId}, ${`Book ${word} tickets`})`
  const [account] = await admin`insert into budget_accounts (owner_id, name) values (${ownerId}, ${`Card ${word}`}) returning id`
  const [tx] = await admin`
    insert into budget_transactions (owner_id, account_id, amount_minor, occurred_on, note)
    values (${ownerId}, ${account!.id}, -25075, current_date, ${`Coffee ${word}`}) returning id`
  txId = tx!.id
})

test.afterAll(async () => {
  const like = `%${word}%`
  await admin`delete from notes_notes where title like ${like} or body like ${like}`
  await admin`delete from tasks_tasks where title like ${like}`
  await admin`delete from budget_transactions where note like ${like}`
  await admin`delete from budget_accounts where name like ${like}`
  await admin.end()
})

test("search needs a session", async ({ request }) => {
  const response = await request.get(`/api/search?q=${word}`)
  expect(response.status()).toBe(401)
})

test.describe("desktop ⌘K", () => {
  test.use({ storageState: OWNER })

  async function openPalette(page: Page) {
    await page.goto("/app")
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    // The palette streams in with the shell; ⌘K before it hydrates does nothing.
    await page.waitForLoadState("networkidle")
    await page.keyboard.press("ControlOrMeta+k")
    const dialog = page.getByRole("dialog", { name: "Search and commands" })
    await expect(dialog).toBeVisible()
    return dialog
  }

  test("finds notes, tasks and money, grouped with counts and highlighted", async ({ page }) => {
    const dialog = await openPalette(page)
    await dialog.getByRole("combobox").fill(word)

    // cmdk labels each group's items with its heading: name and count.
    const notes = dialog.getByRole("group", { name: "Notes 5+" })
    await expect(notes.getByRole("option").filter({ hasText: `Trip ${word}` })).toBeVisible()
    await expect(dialog.getByRole("group", { name: /^Tasks/ })).toContainText(`Book ${word} tickets`)
    const money = dialog.getByRole("group", { name: /^Budget/ }).getByRole("option").first()
    await expect(money).toContainText(`Coffee ${word}`)
    await expect(money).toContainText("250")
    await expect(dialog.locator("mark").filter({ hasText: word }).first()).toBeVisible()

    // The exact title wins inside its group.
    await expect(notes.getByRole("option").first()).toContainText(`Trip ${word}`)

    // "See all" narrows to Notes and shows the sixth one too.
    await notes.getByRole("option", { name: "See all in Notes" }).click()
    await expect(dialog.getByRole("button", { name: /^Notes/, pressed: true })).toBeVisible()
    await expect(dialog.getByRole("group", { name: "Notes 6" }).getByRole("option")).toHaveCount(6)
    await expect(dialog.getByRole("group", { name: /^Budget/ })).toHaveCount(0)
  })

  test("finds an expense by its amount and opens it", async ({ page }) => {
    const dialog = await openPalette(page)
    await dialog.getByRole("button", { name: "Budget" }).click()
    await dialog.getByRole("combobox").fill("250")
    const hit = dialog.getByRole("option").filter({ hasText: `Coffee ${word}` })
    await expect(hit).toBeVisible()
    await hit.click()
    await expect(page).toHaveURL(new RegExp(`/app/budget/transactions\\?month=\\d{4}-\\d{2}&edit=${txId}`))
  })

  test("says what to try when nothing matches", async ({ page }) => {
    const dialog = await openPalette(page)
    await dialog.getByRole("combobox").fill(`nothing${word}`)
    await expect(dialog.getByRole("status").filter({ hasText: "Nothing matches" })).toBeVisible()
    await expect(dialog).toContainText("an amount like 250")
  })
})

/** Today, then the header's search icon (once the page is interactive). */
async function openSheet(page: Page) {
  await page.goto("/app")
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.getByRole("banner").getByRole("button", { name: "Search" }).click()
}

test.describe("phone search sheet", () => {
  test.use({
    storageState: OWNER,
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  })

  test("opens full screen from the header, searches, opens a result and remembers the query", async ({ page }) => {
    const insets = { top: 47, bottom: 34 }
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets })
    await openSheet(page)

    const sheet = page.getByRole("dialog", { name: "Search" })
    await expect(sheet).toBeVisible()
    const box = (await sheet.boundingBox())!
    expect(box.width).toBe(375)
    expect(box.x).toBe(0)

    const field = sheet.getByRole("searchbox", { name: "Search everything" })
    await expect(field).toBeFocused()
    // 16px or more, or iOS zooms the page into the field.
    expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    expect((await field.boundingBox())!.y, "field sits below the status bar").toBeGreaterThanOrEqual(insets.top)
    await expect(sheet).toContainText("Search everything")

    await field.fill(word)
    const notes = sheet.getByRole("region", { name: "Notes" })
    await expect(notes.getByRole("heading")).toContainText("5+")
    await expect(sheet.getByRole("region", { name: "Budget" })).toContainText(`Coffee ${word}`)
    await expect(sheet.getByRole("button", { name: /^Budget/ })).toContainText("1")
    await expectNoHorizontalScroll(page)

    // Chips narrow it down; tapping again shows everything.
    await sheet.getByRole("button", { name: /^Tasks/ }).click()
    await expect(sheet.getByRole("region")).toHaveCount(1)
    await expect(sheet.getByRole("region", { name: "Tasks" })).toContainText(`Book ${word} tickets`)
    await sheet.getByRole("button", { name: /^Tasks/ }).click()
    await expect(sheet.getByRole("region", { name: "Notes" })).toBeVisible()

    for (const link of await notes.getByRole("link").all()) {
      expect((await link.boundingBox())!.height, "result is a comfortable tap target").toBeGreaterThanOrEqual(44)
    }
    await notes.getByRole("link", { name: new RegExp(`Trip ${word}`) }).click()
    await expect(page).toHaveURL(new RegExp(`/app/notes/${noteId}$`))
    await expect(sheet).toBeHidden()

    await page.getByRole("banner").getByRole("button", { name: "Search" }).click()
    const recent = page.getByRole("dialog", { name: "Search" }).getByRole("region", { name: "Recent" })
    await recent.getByRole("button", { name: word, exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Search" }).getByRole("searchbox")).toHaveValue(word)
    await expect(page.getByRole("dialog", { name: "Search" }).getByRole("region", { name: "Notes" })).toBeVisible()

    await page.getByRole("dialog", { name: "Search" }).getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("dialog", { name: "Search" })).toBeHidden()
  })

  test("shows what to try when nothing matches", async ({ page }) => {
    await openSheet(page)
    const sheet = page.getByRole("dialog", { name: "Search" })
    await sheet.getByRole("searchbox").fill(`nothing${word}`)
    await expect(sheet.getByRole("status")).toContainText(`Nothing matches “nothing${word}”`)
  })
})
