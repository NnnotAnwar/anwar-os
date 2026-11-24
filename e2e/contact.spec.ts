// Public contact form: works with and without JavaScript, keeps what was typed
// when it refuses a send, and lands in the owner's Feedback → Contact inbox.
import { randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { adminDb, OWNER, watchCsp } from "./support"

const run = randomBytes(3).toString("hex")
const admin = adminDb()

// Every test here sends from 127.0.0.1: start from a clean rate-limit log.
test.beforeAll(async () => {
  await admin`delete from contact_submissions`
})

test.afterAll(async () => {
  await admin`delete from contact_messages where message like ${`%${run}%`}`
  await admin`delete from contact_submissions`
  await admin.end()
})

async function fill(page: Page, name: string, message: string) {
  await page.getByRole("group", { name: "What is it about?" }).getByText("Job offer").click()
  await page.getByLabel("Your name").fill(name)
  await page.getByLabel("Email").fill(`${name.toLowerCase().replace(/\W+/g, ".")}@company.example`)
  await page.getByLabel("Company").fill("Studio Nová")
  await page.getByLabel("Message").fill(message)
}

test("a visitor sends a job offer; the owner answers it from Feedback → Contact", async ({ page, browser }) => {
  const violations = await watchCsp(page)
  await page.goto("/contact")
  await expect(page.getByRole("heading", { name: "Let’s work together", level: 1 })).toBeVisible()
  await page.waitForLoadState("networkidle")
  const message = `We're hiring a full-stack developer ${run}. Interested?`
  await fill(page, "Jana", message)

  // Too quick: refused, and nothing typed is lost (React resets forms after an action).
  await page.getByRole("button", { name: "Send message" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "That was very quick" })).toBeVisible()
  await expect(page.getByLabel("Message")).toHaveValue(message)
  await expect(page.getByLabel("Your name")).toHaveValue("Jana")
  await expect(page.getByRole("radio", { name: /Job offer/ })).toBeChecked()

  await page.waitForTimeout(3_200)
  await page.getByRole("button", { name: "Send message" }).click()
  await expect(page.getByRole("heading", { name: "Thanks, Jana" })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("status")).toContainText("jana@company.example")
  expect(await violations()).toEqual([])

  const owner = await browser.newContext({ storageState: OWNER })
  const ownerPage = await owner.newPage()
  await ownerPage.goto("/app/feedback")
  const tabs = ownerPage.getByRole("navigation", { name: "Inbox" })
  await expect(tabs.getByRole("link", { name: /Contact/ })).toContainText("new")
  await tabs.getByRole("link", { name: /Contact/ }).click()
  await expect(ownerPage).toHaveURL(/\/app\/feedback\/contact$/)
  await ownerPage.getByRole("link", { name: new RegExp(`hiring a full-stack developer ${run}`) }).click()

  await expect(ownerPage.getByText(message)).toBeVisible()
  await expect(ownerPage.getByRole("link", { name: "jana@company.example" })).toHaveAttribute("href", "mailto:jana@company.example")
  const reply = ownerPage.getByRole("link", { name: "Reply by email" })
  const href = (await reply.getAttribute("href"))!
  expect(href.startsWith("mailto:jana@company.example?subject=")).toBe(true)
  expect(new URL(href).searchParams.get("subject")).toBe("Re: Job offer — anwar-os.com")

  await ownerPage.getByRole("button", { name: "Mark replied" }).click()
  await expect(ownerPage.getByText("Marked replied", { exact: true })).toBeVisible()
  await ownerPage.getByRole("button", { name: "Archive" }).click()
  await expect(ownerPage.getByText("Archived", { exact: true }).first()).toBeVisible()
  await expect.poll(async () => (await admin`select status from contact_messages where message = ${message}`)[0]?.status).toBe("archived")

  await ownerPage.goto("/app/feedback/contact?status=archived")
  await expect(ownerPage.getByText(`hiring a full-stack developer ${run}`)).toBeVisible()
  await owner.close()
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("the form still sends (a plain POST, answered with a redirect)", async ({ page }) => {
    await page.goto("/contact")
    const message = `A booking app for our studio ${run}, budget around 5k.`
    await fill(page, "Petr", message)
    await page.waitForTimeout(3_200)
    await page.getByRole("button", { name: "Send message" }).click()
    await expect(page).toHaveURL(/\/contact\/sent$/)
    await expect(page.getByRole("heading", { name: "Thank you", level: 1 })).toBeVisible()
    await expect.poll(async () => (await admin`select count(*)::int as n from contact_messages where message = ${message}`)[0]!.n).toBe(1)
  })

  test("a refused send says why, with nothing personal in the address", async ({ page }) => {
    await page.goto("/contact")
    await fill(page, "Eva", `Quick one ${run}, sent too fast.`)
    await page.getByRole("button", { name: "Send message" }).click()
    await expect(page).toHaveURL(/\/contact\?error=fast$/)
    await expect(page.getByRole("alert").filter({ hasText: "That was very quick" })).toBeVisible()
    expect(page.url()).not.toContain("Eva")
  })
})

test("the site links to the contact form from the menu, the footer and the home page", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact")
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Write to me" })).toHaveAttribute("href", "/contact")
  await expect(page.getByRole("link", { name: "Get in touch" })).toHaveAttribute("href", "/contact")
})
