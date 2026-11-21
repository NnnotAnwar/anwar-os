// The services grid: a card opens its sheet; starring moves it to My services
// in one tap, and the toast's Undo puts it back.
import { expect, test } from "@playwright/test"
import { OWNER } from "./support"

test.use({ storageState: OWNER })

test("open a card's sheet, star it, and undo", async ({ page }) => {
  await page.goto("/app/services")
  const mine = page.getByRole("region", { name: "My services" })
  const all = page.getByRole("region", { name: "All services" })

  // The first service not yet in My services.
  const card = all.getByRole("button").first()
  const name = (await card.locator(".text-body-strong").textContent())!.trim()
  await card.click()

  const sheet = page.getByRole("dialog", { name })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole("link", { name: `Open ${name}` })).toBeVisible()

  const star = sheet.getByRole("button", { name: "Add to My services" })
  await expect(star).toHaveAttribute("aria-pressed", "false")
  await star.click()
  await expect(page.getByText(`${name} added to My services`)).toBeVisible()
  // The card moves to My services (its sheet goes with it).
  await expect(mine.getByRole("button", { name })).toBeVisible()
  await expect(all.getByRole("button", { name })).toHaveCount(0)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(mine.getByRole("button", { name })).toHaveCount(0)
  await expect(all.getByRole("button", { name })).toBeVisible()
})
