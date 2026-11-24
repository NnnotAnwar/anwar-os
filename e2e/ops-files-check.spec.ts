// Ops → Server → Files storage: the tile for the weekly files storage check.
// The browser tests run without object storage, so a stored result is put in
// place for the owner (ops_files_check) through MIGRATION_DATABASE_URL; the
// check itself, osbot's run and "Delete orphans" are covered by
// db/tests/ops-files-check.test.ts.
import { randomUUID } from "node:crypto"
import { expect, test } from "@playwright/test"
import { adminDb, expectNoHorizontalScroll, OWNER, ownerCredentials } from "./support"

test.use({ storageState: OWNER })
test.describe.configure({ mode: "serial" })

const admin = adminDb()
let ownerId = ""

const findings = (owner: string) => ({
  objects: 1234,
  bytes: 2.5 * 1024 ** 3,
  rows: 1233,
  rowBytes: 2.4 * 1024 ** 3,
  ignored: { prefixes: ["postgres/"], objects: 12, bytes: 3_500_000 },
  missingCount: 2,
  missing: [
    { key: `${owner}/${randomUUID()}`, fileId: randomUUID(), name: "Tax return 2025.pdf", size: 120_000 },
    { key: `other/${randomUUID()}`, fileId: randomUUID(), name: null, size: 5000 },
  ],
  mismatchedCount: 0,
  mismatched: [],
  orphanCount: 3,
  orphanBytes: 12.5 * 1024 ** 2,
  orphans: [
    { key: `${owner}/${randomUUID()}`, size: 8 * 1024 ** 2, lastModified: new Date(Date.now() - 3 * 86_400_000).toISOString(), deletable: true },
    { key: `${owner}/${randomUUID()}`, size: 4 * 1024 ** 2, lastModified: null, deletable: true },
    { key: "loose-export.zip", size: 10, lastModified: null, deletable: false },
  ],
  recent: 1,
})

test.beforeAll(async () => {
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  ownerId = owner!.id as string
})

test.afterAll(async () => {
  await admin`delete from ops_files_check where owner_id = ${ownerId}`
  await admin.end()
})

test("shows the last check: lost files, leftovers and the bucket's size", async ({ page }) => {
  await admin`
    insert into ops_files_check (owner_id, status, checked_at, duration_ms, findings)
    values (${ownerId}, 'problems', now() - interval '2 days', 840, ${admin.json(findings(ownerId))})
    on conflict (owner_id) do update set status = excluded.status, checked_at = excluded.checked_at, findings = excluded.findings, error = null`

  await page.goto("/app/ops#server")
  const tile = page.getByRole("article", { name: "Files storage" })
  await expect(tile).toBeVisible()
  await expect(tile).toContainText("Needs attention")
  await expect(tile).toContainText("1,234 files")
  await expect(tile).toContainText("2.5 GB")
  await expect(tile).toContainText("12 objects · 3.3 MB in postgres/")
  await expect(tile).toContainText("2 d")

  const missing = tile.getByRole("region", { name: "2 files missing from the bucket" })
  await expect(missing).toContainText("Tax return 2025.pdf")
  await expect(missing).toContainText("Another account's file")

  const orphans = tile.getByRole("region", { name: "Orphaned objects" })
  await expect(orphans).toContainText("3 orphaned objects · 12.5 MB")
  await expect(orphans).toContainText("loose-export.zip")
  await expect(orphans).toContainText("remove them by hand")

  // No storage in the browser tests: the result stays readable, nothing can run.
  await expect(tile).toContainText("This is the last result.")
  await expect(tile.getByRole("button", { name: "Check now" })).toHaveCount(0)
  await expect(tile.getByRole("button", { name: "Delete orphans" })).toHaveCount(0)

  // The alert settings know the new kind.
  await expect(page.getByRole("region", { name: "Telegram alerts" }).getByRole("switch", { name: "Files storage" })).toBeChecked()
})

test("a failed check says why", async ({ page }) => {
  await admin`
    insert into ops_files_check (owner_id, status, checked_at, error)
    values (${ownerId}, 'error', now(), 'Access Denied (HTTP 403)')
    on conflict (owner_id) do update set status = excluded.status, checked_at = excluded.checked_at, error = excluded.error, findings = '{}'`
  await page.goto("/app/ops#server")
  const tile = page.getByRole("article", { name: "Files storage" })
  await expect(tile.getByRole("status")).toHaveText("The last check failed: Access Denied (HTTP 403)")
  await expect(tile).toContainText("Watch")
})

test("fits a phone, and says when there is nothing to check", async ({ page }) => {
  await admin`delete from ops_files_check where owner_id = ${ownerId}`
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/app/ops#server")
  const tile = page.getByRole("article", { name: "Files storage" })
  await expect(tile).toContainText("File storage isn't configured (S3_* variables), so there is nothing to check.")
  await expect(tile).toContainText("Unknown")
  await expectNoHorizontalScroll(page)

  await admin`
    insert into ops_files_check (owner_id, status, checked_at, duration_ms, findings)
    values (${ownerId}, 'problems', now(), 840, ${admin.json(findings(ownerId))})`
  await page.reload()
  await expect(page.getByRole("article", { name: "Files storage" })).toContainText("1,234 files")
  await expectNoHorizontalScroll(page)
})
