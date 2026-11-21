// Public feedback: the form solves its proof of work in the browser, the
// message lands in the owner's private feedback list.
import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { OWNER } from "./support"

const message = `E2E feedback ${randomBytes(3).toString("hex")}: the calculator is great.`

test("a visitor sends feedback and the owner sees it", async ({ page, browser }) => {
  await page.goto("/feedback")
  await page.getByRole("group", { name: "What is it?" }).getByText("Suggestion").click()
  await page.getByLabel("Message").fill(message)
  await page.getByLabel("Name").fill("E2E")
  // The server refuses forms sent within 3 s of loading (bots are quick).
  await page.waitForTimeout(3_200)
  await page.getByRole("button", { name: "Send feedback" }).click()
  await expect(page.getByRole("heading", { name: "Sent — thank you" })).toBeVisible({ timeout: 20_000 })

  const owner = await browser.newContext({ storageState: OWNER })
  const ownerPage = await owner.newPage()
  await ownerPage.goto("/app/feedback")
  await expect(ownerPage.getByText(message.slice(0, 40))).toBeVisible()
  await owner.close()
})
