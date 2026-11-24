// The AI assistant without ANTHROPIC_API_KEY (pnpm e2e runs with it empty): the
// page explains how to switch it on, ⌘K and Settings know about it, and the
// chat API refuses politely. Full chat turns (tools, confirm cards, storage) are
// covered with a scripted Claude in db/tests/assistant.test.ts.
import { expect, test } from "@playwright/test"
import { OWNER } from "./support"

test.use({ storageState: OWNER })

test("assistant shows how to switch it on when the server has no key", async ({ page }) => {
  await page.goto("/app/assistant")
  const card = page.getByTestId("assistant-disabled")
  await expect(card).toBeVisible()
  await expect(card.getByRole("heading", { name: "Add ANTHROPIC_API_KEY on the server" })).toBeVisible()
  await expect(card).toContainText("console.anthropic.com")

  // A conversation URL shows the same state instead of an error.
  await page.goto("/app/assistant/00000000-0000-4000-8000-000000000000")
  await expect(page.getByTestId("assistant-disabled")).toBeVisible()

  const response = await page.request.post("/api/assistant/chat", { data: { text: "hi" } })
  expect(response.status()).toBe(503)
  expect(await response.json()).toMatchObject({ error: "ai_disabled" })
})

test("assistant is reachable from ⌘K and Settings shows its usage line", async ({ page }) => {
  await page.goto("/app")
  // The palette mounts behind a Suspense boundary: retry ⌘K until it opens.
  const palette = page.getByRole("dialog", { name: "Search and commands" })
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1000 })
  }).toPass()
  await palette.getByPlaceholder("Search notes, pages, commands…").fill("Assistant")
  await palette.getByRole("option", { name: "Assistant" }).first().click()
  await expect(page).toHaveURL(/\/app\/assistant$/)

  await page.goto("/app/settings")
  const usage = page.getByTestId("assistant-usage")
  await expect(usage).toContainText("Off · add ANTHROPIC_API_KEY on the server")
  await expect(usage).toContainText(/0 requests · 0 tokens · ≈ \$0\.00/)
})
