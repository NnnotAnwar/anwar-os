// Budget → Subscriptions: add one, see what it costs a month and a year and when
// it charges, pause it (one tap, Undo), turn a recurring payment into a
// subscription, cancel with Undo. Today shows the charge under "Upcoming payments".
import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { adminDb, OWNER, ownerCredentials } from "./support"

test.use({ storageState: OWNER })

const run = randomBytes(3).toString("hex")
const netflix = `Netflix ${run}`
const rent = `Rent ${run}`

// Its own account: the page needs one, and other specs create and delete theirs.
const account = `Card ${run}`

test.beforeAll(async () => {
  const admin = adminDb()
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  await admin`insert into budget_accounts (owner_id, name) values (${owner!.id as string}, ${account})`
  await admin.end()
})

test.afterAll(async () => {
  const admin = adminDb()
  await admin`delete from budget_recurring where note like ${`% ${run}`}`
  // Transactions block an account delete (on delete restrict): charges recorded here go first.
  await admin`delete from budget_transactions where account_id in (select id from budget_accounts where name = ${account})`
  await admin`delete from budget_accounts where name = ${account}`
  await admin.end()
})

test("subscriptions: add, totals, pause, mark and cancel", async ({ page }) => {
  await page.goto("/app/budget/subscriptions")
  await expect(page.getByRole("heading", { level: 1, name: "Subscriptions" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Budget sections" }).getByRole("link", { name: "Subscriptions" })).toHaveAttribute(
    "aria-current",
    "page",
  )

  // A new subscription: the form starts with "Subscription" switched on.
  await page.getByRole("button", { name: "New subscription" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("switch", { name: "Subscription" })).toBeChecked()
  await sheet.getByLabel("What").fill(netflix)
  await sheet.getByLabel("Amount").fill("299")
  await sheet.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText("Recurring payment added")).toBeVisible()

  const row = page.getByTestId("subscription-row").filter({ hasText: netflix })
  await expect(row).toBeVisible()
  await expect(row).toContainText("Every month")
  // Starts today, so the first charge is today.
  await expect(row).toContainText("Today")
  await expect(page.getByTestId("subscriptions-total")).toContainText(/Subscriptions cost .+ a month · .+ a year/)

  // A recurring payment that isn't a subscription goes under "Other recurring payments".
  await page.getByRole("button", { name: "New subscription" }).click()
  await sheet.getByRole("switch", { name: "Subscription" }).uncheck()
  await sheet.getByLabel("What").fill(rent)
  await sheet.getByLabel("Amount").fill("18000")
  await sheet.getByRole("button", { name: "Add", exact: true }).click()
  const other = page.getByRole("region", { name: "Other recurring payments" }).getByTestId("subscription-row").filter({ hasText: rent })
  await expect(other).toBeVisible()
  await expect(page.getByText(/All recurring payments: .+ a month/)).toBeVisible()

  // One tap makes it a subscription (with Undo).
  await other.getByRole("button", { name: `Mark ${rent} as a subscription` }).click()
  await expect(page.getByText(`${rent} is a subscription`)).toBeVisible()
  await expect(page.getByRole("region", { name: "Subscriptions" }).getByTestId("subscription-row").filter({ hasText: rent })).toBeVisible()

  // Pause: no charges until resumed.
  await row.getByRole("button", { name: `Pause ${netflix}` }).click()
  await expect(row).toContainText("Paused")
  await row.getByRole("button", { name: `Resume ${netflix}` }).click()
  await expect(row).not.toContainText("Paused")

  // Today lists the charge under "Upcoming payments".
  await page.goto("/app")
  const widget = page.getByRole("region", { name: "Upcoming payments" })
  await expect(widget).toContainText(netflix)

  // Cancel with Undo, then for real.
  await page.goto("/app/budget/subscriptions")
  await row.getByRole("button", { name: `Cancel ${netflix}` }).click()
  await expect(row).toBeHidden()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(row).toBeVisible()
  await row.getByRole("button", { name: `Cancel ${netflix}` }).click()
  await expect(row).toBeHidden()
  await expect.poll(async () => {
    const admin = adminDb()
    const rows = await admin`select 1 from budget_recurring where note = ${netflix}`
    await admin.end()
    return rows.length
  }, { timeout: 15_000 }).toBe(0)
})
