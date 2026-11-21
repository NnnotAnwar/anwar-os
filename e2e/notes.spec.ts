// Notes autosave: a new note gets its id on the first save and the URL swaps in
// place (no remount, typing continues); later edits save on their own.
import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { OWNER } from "./support"

test.use({ storageState: OWNER })

test("a new note saves as you type and keeps its URL across reloads", async ({ page }) => {
  const title = `E2E note ${randomBytes(3).toString("hex")}`
  await page.goto("/app/notes/new")
  await expect(page.getByText("Saves as you type once it has a title")).toBeVisible()

  const titleField = page.locator("#note-title")
  const body = page.locator("#note-body")
  await titleField.fill(title)
  await body.click()
  await body.pressSequentially("First line")

  // The first save creates the note and swaps the URL without a navigation.
  await expect(page).toHaveURL(/\/app\/notes\/[0-9a-f-]{36}$/)
  const url = page.url()
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible()
  // Still the same editor: the caret stayed in the body.
  await expect(body).toBeFocused()

  await body.pressSequentially(", and more.")
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeHidden()
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible()

  await page.reload()
  expect(page.url()).toBe(url)
  await expect(titleField).toHaveValue(title)
  // A saved note with a body reopens in Preview.
  await expect(page.locator("main").getByText("First line, and more.")).toBeVisible()

  await page.goto("/app/notes")
  await expect(page.getByText(title)).toBeVisible()
})
