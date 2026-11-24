// Budget → Limits: set a monthly limit on a category, see what's left (amber
// from 90 %, red once over), change it, find it on Today, remove it with Undo.
import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { adminDb, expectNoHorizontalScroll, OWNER, ownerCredentials } from "./support"

test.use({ storageState: OWNER })

const run = randomBytes(3).toString("hex")
const category = `Treats ${run}`
// Its own account: other specs create and delete theirs.
const account = `Wallet ${run}`
let categoryId = ""

test.beforeAll(async () => {
  const admin = adminDb()
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  const ownerId = owner!.id as string
  const [acc] = await admin`insert into budget_accounts (owner_id, name, currency) values (${ownerId}, ${account}, 'CZK') returning id`
  const [cat] = await admin`insert into budget_categories (owner_id, name, kind) values (${ownerId}, ${category}, 'expense') returning id`
  categoryId = cat!.id
  // 950 CZK this month: 95 % of a 1 000 limit.
  await admin`
    insert into budget_transactions (owner_id, account_id, category_id, amount_minor, occurred_on, note)
    values (${ownerId}, ${acc!.id}, ${categoryId}, -95000, current_date, ${`cake ${run}`})`
  await admin.end()
})

test.afterAll(async () => {
  const admin = adminDb()
  await admin`delete from budget_limits where category_id = ${categoryId}`
  await admin`delete from budget_transactions where account_id in (select id from budget_accounts where name = ${account})`
  await admin`delete from budget_categories where id = ${categoryId}`
  await admin`delete from budget_accounts where name = ${account}`
  await admin.end()
})

test("limits: set, see what's left, change, Today, remove with Undo", async ({ page }) => {
  await page.goto("/app/budget/limits")
  await expect(page.getByRole("heading", { level: 1, name: "Limits" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Budget sections" }).getByRole("link", { name: "Limits" })).toHaveAttribute("aria-current", "page")

  await page.getByRole("button", { name: "Set a limit" }).click()
  const sheet = page.getByRole("dialog")
  await sheet.getByLabel("Category").selectOption({ label: category })
  await expect(sheet).toContainText("No spending here in the last three months.")
  await sheet.getByLabel(/A month/).fill("1000")
  await sheet.getByRole("button", { name: "Set limit" }).click()
  await expect(page.getByText("Limit set")).toBeVisible()

  const card = page.getByRole("button", { name: `Edit the limit for ${category}` })
  await expect(card).toBeVisible()
  await expect(card).toContainText("95 %")
  await expect(card).toContainText(/50 left/)
  // Amber from 90 %.
  await expect(card.getByText("95 %")).toHaveClass(/text-warning-text/)
  await expectNoHorizontalScroll(page)

  // Lower it below what's spent: over, in red.
  await card.click()
  await expect(sheet.getByRole("link", { name: /see the transactions/ })).toHaveAttribute("href", new RegExp(`category=${categoryId}`))
  await sheet.getByLabel(/A month/).fill("900")
  await sheet.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Limit saved")).toBeVisible()
  await expect(card).toContainText(/Over by .*50/)
  await expect(card.getByText("105 %")).toHaveClass(/text-destructive/)

  // Today: the "Budget limits" widget.
  await page.goto("/app")
  const widget = page.getByRole("region", { name: "Budget limits" })
  await expect(widget).toContainText(category)
  await expect(widget).toContainText(/over by .*50/)

  // Remove with Undo, then for real.
  await page.goto("/app/budget/limits")
  await card.click()
  await sheet.getByRole("button", { name: "Remove limit" }).click()
  await expect(card).toBeHidden()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(card).toBeVisible()
  await card.click()
  await sheet.getByRole("button", { name: "Remove limit" }).click()
  await expect(card).toBeHidden()
  await expect
    .poll(
      async () => {
        const admin = adminDb()
        const rows = await admin`select 1 from budget_limits where category_id = ${categoryId}`
        await admin.end()
        return rows.length
      },
      { timeout: 15_000 },
    )
    .toBe(0)
})
