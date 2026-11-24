// The monthly report page: this month against the last, month switching, the
// PDF download and "Save to Files" (no object storage in the browser tests, so
// it offers the download instead). A Budget expense with a unique category is
// inserted for the seeded owner and removed after.
import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { PDFDocument } from "pdf-lib"
import { adminDb, expectNoHorizontalScroll, OWNER, ownerCredentials } from "./support"

const tag = randomBytes(3).toString("hex")
const category = `Snacks ${tag}`
const admin = adminDb()
let account = ""
let month = ""
let previous = ""

test.use({ storageState: OWNER })

test.beforeAll(async () => {
  const [owner] = await admin`select id, timezone from auth."user" where email = ${ownerCredentials().email}`
  const zone = (owner!.timezone as string | null) ?? "Europe/Prague"
  const [row] = await admin`select to_char(now() at time zone ${zone}, 'YYYY-MM') as month,
                                   to_char((now() at time zone ${zone}) - interval '1 month', 'YYYY-MM') as previous`
  month = row!.month
  previous = row!.previous
  const [acc] = await admin`insert into budget_accounts (owner_id, name) values (${owner!.id}, ${`Report ${tag}`}) returning id`
  account = acc!.id
  const [cat] = await admin`insert into budget_categories (owner_id, name, kind) values (${owner!.id}, ${category}, 'expense') returning id`
  await admin`
    insert into budget_transactions (owner_id, account_id, category_id, amount_minor, occurred_on, note) values
      (${owner!.id}, ${account}, ${cat!.id}, -34500, ${`${month}-01`}, ${`e2e-${tag}`}),
      (${owner!.id}, ${account}, ${cat!.id}, -10000, ${`${previous}-10`}, ${`e2e-${tag}`})`
})

test.afterAll(async () => {
  await admin`delete from budget_transactions where account_id = ${account}`
  await admin`delete from budget_categories where name = ${category}`
  await admin`delete from budget_accounts where id = ${account}`
  await admin.end()
})

test("shows this month against the last, and switches months", async ({ page }) => {
  await page.goto("/app/review")
  await expect(page.getByRole("heading", { level: 1, name: "Monthly report" })).toBeVisible()
  const list = page.getByRole("list", { name: "Spending by category" })
  const row = list.getByRole("listitem").filter({ hasText: category })
  await expect(row).toContainText("CZK 345")
  await expect(row).toContainText("CZK 100")

  await page.getByRole("link", { name: "Previous month" }).click()
  await expect(page).toHaveURL(new RegExp(`/app/review\\?month=${previous}$`))
  await expect(page.getByRole("list", { name: "Spending by category" }).getByRole("listitem").filter({ hasText: category })).toContainText(
    "CZK 100",
  )
  await page.getByRole("link", { name: "This month" }).click()
  await expect(page).toHaveURL(/\/app\/review$/)
})

test("downloads the PDF and offers it when storage isn't set up", async ({ page }) => {
  const response = await page.request.get(`/app/review/pdf?month=${month}`)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toBe("application/pdf")
  expect(response.headers()["content-disposition"]).toContain(`Monthly report ${month}.pdf`)
  const doc = await PDFDocument.load(await response.body())
  expect(doc.getTitle()).toContain("Monthly report")

  expect((await page.request.get("/app/review/pdf?month=2026-13")).status()).toBe(400)

  await page.goto("/app/review")
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Save to Files" }).click()
  await expect(page.getByText("File storage isn't set up")).toBeVisible()
})

test("the PDF needs a session", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  // The /app proxy sends anyone without a session to sign in; the handler would refuse with 401.
  const response = await context.request.get("/app/review/pdf", { maxRedirects: 0 })
  expect([302, 303, 307, 401]).toContain(response.status())
  expect(response.headers()["content-type"] ?? "").not.toContain("application/pdf")
  await context.close()
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })

  test("fits the screen with comfortable tap targets", async ({ page }) => {
    await page.goto(`/app/review?month=${previous}`)
    await expect(page.getByRole("heading", { level: 1, name: "Monthly report" })).toBeVisible()
    await expectNoHorizontalScroll(page)
    for (const name of ["Previous month", "Next month"]) {
      const box = await page.getByRole("link", { name }).boundingBox()
      expect(box!.height, `${name} is a comfortable tap target`).toBeGreaterThanOrEqual(44)
    }
  })
})
