// The monthly report end to end: the review module's actions (monthly,
// savePdf), osbot's monthly + monthly/ack + monthly/pdf, the "monthly" kind on
// osbot_deliveries, and that nobody but the owner gets the owner's figures.
// Saving into Files → Reports runs only when S3_* is set. `pnpm test:db`.
import { randomBytes } from "node:crypto"
import { PDFDocument } from "pdf-lib"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

const SECRET = `osbot-monthly-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"

const routes = await import("@/modules/osbot/monthly-routes")
const { actAs, loadViewer } = await import("@/core/auth")
const { actions } = await import("@/modules/review/actions")
const { monthOf, shiftMonth, todayIn } = await import("@/modules/budget/lib/dates")
const { storageConfigured } = await import("@/modules/files/lib/s3")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-review-bob-${run}`
const marker = `review-${run}`
let owner = ""
let createdOwner = false
let account = ""
let category = ""
let month = ""
let previous = ""

type Handler = (request: Request) => Promise<Response>
const P = "/api/internal/osbot"

async function call(handler: Handler, method: "GET" | "POST", path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers = signedHeaders(SECRET, { method, path: `${P}${path}`, body: raw })
  const response = await handler(
    new Request(`http://127.0.0.1:3303${P}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "POST" ? raw : undefined,
    }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

async function as<T>(who: string, fn: () => Promise<T>) {
  const viewer = await loadViewer(who)
  return actAs(viewer!, fn)
}

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-review-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`insert into auth."user" (id, name, email, email_verified) values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  const viewer = await loadViewer(owner)
  const today = todayIn(viewer!.timezone)
  month = monthOf(today)
  previous = shiftMonth(month, -1)

  const [acc] = await admin`
    insert into budget_accounts (owner_id, name, currency) values (${owner}, ${`Review bank ${marker}`}, 'CZK') returning id`
  account = acc!.id
  const [cat] = await admin`
    insert into budget_categories (owner_id, name, kind) values (${owner}, ${`Food ${marker}`}, 'expense') returning id`
  category = cat!.id
  await admin`
    insert into budget_transactions (owner_id, account_id, category_id, amount_minor, occurred_on, note) values
      (${owner}, ${account}, ${category}, -120000, ${`${month}-01`}, ${`This month ${marker}`}),
      (${owner}, ${account}, ${category}, -80000, ${`${previous}-15`}, ${`Last month ${marker}`})`
  await admin`insert into tasks_tasks (owner_id, title, done_at) values (${owner}, ${`Done ${marker}`}, now())`
  await admin`insert into notes_notes (owner_id, title, body) values (${owner}, ${`Note ${marker}`}, '')`
  // Analytics counts UTC days: the 1st of each month is inside both month windows in any timezone.
  await admin`
    insert into analytics_daily (owner_id, day, path, referrer_host, device, country, views) values
      (${owner}, ${`${month}-01`}, ${`/review-${run}`}, '', 'desktop', '', 7),
      (${owner}, ${`${previous}-02`}, ${`/review-${run}`}, '', 'mobile', '', 3)`
})

afterAll(async () => {
  await admin`delete from osbot_deliveries where owner_id in (${owner}, ${bob}) and kind = 'monthly'`
  await admin`delete from budget_transactions where account_id = ${account}`
  await admin`delete from budget_categories where id = ${category}`
  await admin`delete from budget_accounts where id = ${account}`
  await admin`delete from tasks_tasks where title = ${`Done ${marker}`}`
  await admin`delete from notes_notes where title = ${`Note ${marker}`}`
  await admin`delete from analytics_daily where path = ${`/review-${run}`}`
  await admin`delete from files_files where owner_id = ${owner} and tags @> array['report'] and name like 'Monthly report %'`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("review: monthly action", () => {
  it("adds up the month against the month before", async () => {
    const report = await as(owner, () => actions.monthly.handler({ month }))
    expect(report).toMatchObject({ month, previousMonth: previous, partial: true, delivered: false })
    expect(report.url).toMatch(new RegExp(`/app/review\\?month=${month}$`))

    const food = report.spending!.categories.find((c) => c.name === `Food ${marker}`)
    expect(food).toMatchObject({ amountMinor: 120000, previousMinor: 80000 })
    expect(report.spending!.currency).toBe("CZK")
    expect(report.spending!.expenseMinor).toBeGreaterThanOrEqual(120000)
    expect(report.spending!.previousExpenseMinor).toBeGreaterThanOrEqual(80000)

    expect(report.tasks!.done).toBeGreaterThanOrEqual(1)
    expect(report.captured.notes).toBeGreaterThanOrEqual(1)
    expect(report.site!.views).toBeGreaterThanOrEqual(7)
    expect(report.site!.previousViews).toBeGreaterThanOrEqual(3)
    expect(report.site!.pages.map((p) => p.path)).toContain(`/review-${run}`)
    expect(report.subscriptions).not.toBeNull()
  })

  it("reports last month as complete, with this month's money left out", async () => {
    const report = await as(owner, () => actions.monthly.handler({ month: previous }))
    expect(report.partial).toBe(false)
    const food = report.spending!.categories.find((c) => c.name === `Food ${marker}`)
    expect(food).toMatchObject({ amountMinor: 80000, previousMinor: 0 })
  })

  it("gives someone else none of the owner's figures", async () => {
    const report = await as(bob, () => actions.monthly.handler({ month }))
    // Owner-only modules are off for Bob's role; public ones count only his own rows (RLS).
    expect(report.spending).toBeNull()
    expect(report.site).toBeNull()
    expect(report.tasks?.done ?? 0).toBe(0)
    expect(report.captured.notes ?? 0).toBe(0)
  })
})

describe("osbot API: monthly report", () => {
  it("serves the report and is idempotent through monthly/ack", async () => {
    const first = await call(routes.monthlyGET, "GET", `/monthly?month=${month}`)
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ month, delivered: false })
    expect(first.json.spending.categories.some((c: { name: string }) => c.name === `Food ${marker}`)).toBe(true)

    expect((await call(routes.monthlyAckPOST, "POST", "/monthly/ack", { month })).json).toEqual({ acked: 1 })
    expect((await call(routes.monthlyAckPOST, "POST", "/monthly/ack", { month })).json).toEqual({ acked: 0 })
    expect((await call(routes.monthlyGET, "GET", `/monthly?month=${month}`)).json.delivered).toBe(true)
    expect((await call(routes.monthlyGET, "GET", `/monthly?month=${previous}`)).json.delivered).toBe(false)
  })

  it("defaults to this month and refuses a malformed one", async () => {
    expect((await call(routes.monthlyGET, "GET", "/monthly")).json.month).toBe(month)
    expect((await call(routes.monthlyGET, "GET", "/monthly?month=2026-13")).status).toBe(400)
    expect((await call(routes.monthlyAckPOST, "POST", "/monthly/ack", { month: "October" })).status).toBe(400)
  })

  it.skipIf(storageConfigured())("falls back to the in-app PDF when storage isn't configured", async () => {
    const { status, json } = await call(routes.monthlyPdfPOST, "POST", "/monthly/pdf", { month: previous })
    expect(status).toBe(200)
    expect(json).toMatchObject({ saved: false, fileId: null, name: `Monthly report ${previous}.pdf` })
    expect(json.url).toMatch(new RegExp(`/app/review/pdf\\?month=${previous}$`))
  })
})

describe.skipIf(!storageConfigured())("review: saving to Files (S3)", () => {
  it("files the PDF under Reports once per month, replacing it on a second save", async () => {
    const first = await as(owner, () => actions.savePdf.handler({ month: previous }))
    expect(first).toMatchObject({ saved: true, name: `Monthly report ${previous}.pdf` })
    expect(first.url).toMatch(new RegExp(`/app/files/file/${first.fileId}$`))
    const again = await call(routes.monthlyPdfPOST, "POST", "/monthly/pdf", { month: previous })
    expect(again.json.fileId).toBe(first.fileId)

    const rows = await admin`
      select f.name, f.mime, f.size_bytes, d.name as folder, d.parent_id
        from files_files f join files_folders d on d.id = f.folder_id
       where f.id = ${first.fileId!}`
    expect(rows[0]).toMatchObject({ mime: "application/pdf", folder: "Reports", parent_id: null })
    const [{ n }] = await admin`select count(*)::int as n from files_folders where owner_id = ${owner} and name = 'Reports' and parent_id is null`
    expect(n).toBe(1)

    const url = await as(owner, async () => {
      const { actions: files } = await import("@/modules/files/actions")
      return files.downloadUrl.handler({ id: first.fileId!, inline: false })
    })
    const bytes = new Uint8Array(await (await fetch(url!)).arrayBuffer())
    expect(Number(rows[0]!.size_bytes)).toBe(bytes.byteLength)
    expect((await PDFDocument.load(bytes)).getTitle()).toContain("Monthly report")
  })
})

describe("osbot deliveries: the monthly kind", () => {
  it("accepts the owner's monthly rows and still hides them from others", async () => {
    await app.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${owner}, true)`
      await sql`insert into osbot_deliveries (kind, key) values ('monthly', ${`2001-01`}) on conflict do nothing`
    })
    const seen = await app.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${bob}, true)`
      return sql`select 1 from osbot_deliveries where owner_id = ${owner} and kind = 'monthly'`
    })
    expect(seen).toHaveLength(0)
  })
})
