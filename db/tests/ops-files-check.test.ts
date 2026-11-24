// Files storage check: the owner-only inventory function, RLS on
// ops_files_check, osbot's /api/internal/osbot/files-check/run end to end
// against an in-memory bucket (the S3 module is mocked), the "files" server
// alerts it raises through ops-alerts/check, and "Delete orphans".
// `pnpm test:db`. `admin` sets up fixtures, `app` connects as os_app.
import { randomBytes, randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/modules/osbot/signature"

const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

// The bucket: key → size and last change. `failList` makes the listing throw.
const s3 = vi.hoisted(() => ({
  configured: true,
  failList: null as Error | null,
  objects: new Map<string, { size: number; lastModified: Date }>(),
  deleted: [] as string[],
}))
vi.mock("@/modules/files/lib/s3", () => ({
  storageConfigured: () => s3.configured,
  async *listObjects() {
    if (s3.failList) throw s3.failList
    for (const [key, o] of s3.objects) yield { key, size: o.size, lastModified: o.lastModified }
  },
  async headObject(key: string) {
    const o = s3.objects.get(key)
    return o ? { size: o.size, lastModified: o.lastModified } : null
  },
  async removeObjects(keys: string[]) {
    for (const k of keys) {
      s3.objects.delete(k)
      s3.deleted.push(k)
    }
  },
}))

const SECRET = `osbot-test-${randomBytes(24).toString("hex")}`
process.env.OSBOT_API_SECRET = SECRET
// No ops-agent and no HTTPS site: the alert check raises only the files alerts.
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3303"
delete process.env.OPS_AGENT_URL
delete process.env.FILES_CHECK_IGNORE_PREFIXES
delete process.env.BACKUP_PREFIX

const runApi = await import("@/modules/ops/files-check-api")
const alertsApi = await import("@/modules/ops/alerts-api")
const { actAs, loadViewer } = await import("@/core/auth")
const { deleteOrphans, runFilesCheck } = await import("@/modules/ops/files-check")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-files-check-alice-${run}`
let owner = ""
let createdOwner = false
const fileIds: string[] = []

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)
const key = (who: string) => `${who}/${randomUUID()}`

// Owner: a good file, a lost one, one whose object has the wrong size.
// Alice: a good file (its object must not look orphaned to the owner) and a lost one.
let ownerOk = ""
let ownerLost = ""
let ownerWrong = ""
let aliceOk = ""
let aliceLost = ""
// No row: an old upload left behind, a fresh one, a key the app never issues, a backup.
let leftover = ""
let fresh = ""
const stray = `stray-${run}.txt`
const backup = `postgres/daily/anwar_os-${run}.dump.age`

function as<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>, token?: string) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
    if (token) await sql`select set_config('app.api_token_id', ${token}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function pgError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    return (e as { code?: string }).code
  }
  return null
}

async function addFile(who: string, name: string, size: number, objectSize: number | null) {
  const k = key(who)
  const [row] = await admin`
    insert into files_files (owner_id, name, size_bytes, mime, storage_key)
    values (${who}, ${name}, ${size}, 'application/pdf', ${k}) returning id`
  fileIds.push(row!.id)
  if (objectSize != null) s3.objects.set(k, { size: objectSize, lastModified: hoursAgo(72) })
  return k
}

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-files-check-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`insert into auth."user" (id, name, email, email_verified) values (${alice}, 'Alice', ${`${alice}@test.local`}, true)`
  await admin`delete from ops_files_check where owner_id = ${owner}`
  await admin`delete from ops_alert_state where owner_id = ${owner}`
})

beforeEach(async () => {
  s3.configured = true
  s3.failList = null
  s3.objects.clear()
  s3.deleted = []
  await admin`delete from files_files where id = any(${fileIds})`
  fileIds.length = 0
  ownerOk = await addFile(owner, `Tax return ${run}.pdf`, 1000, 1000)
  ownerLost = await addFile(owner, `Contract ${run}.pdf`, 2000, null)
  ownerWrong = await addFile(owner, `Scan ${run}.pdf`, 3000, 2500)
  aliceOk = await addFile(alice, "Alice's notes.pdf", 400, 400)
  aliceLost = await addFile(alice, "Alice's secret.pdf", 500, null)
  leftover = key(owner)
  fresh = key(owner)
  s3.objects.set(leftover, { size: 7000, lastModified: hoursAgo(50) })
  s3.objects.set(fresh, { size: 100, lastModified: hoursAgo(1) })
  s3.objects.set(stray, { size: 30, lastModified: hoursAgo(500) })
  s3.objects.set(backup, { size: 290_000, lastModified: hoursAgo(5) })
  await admin`delete from ops_files_check where owner_id = ${owner}`
  await admin`delete from ops_alert_state where owner_id = ${owner}`
  await admin`delete from ops_alert_settings where owner_id = ${owner}`
})

afterAll(async () => {
  await admin`delete from files_files where id = any(${fileIds})`
  await admin`delete from ops_files_check where owner_id = ${owner}`
  await admin`delete from ops_alert_state where owner_id = ${owner}`
  await admin`delete from ops_alert_settings where owner_id = ${owner}`
  await admin`delete from auth."user" where id = ${alice}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(handler: (r: Request) => Promise<Response>, path: string, body?: unknown, signed = true) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers = signed ? signedHeaders(SECRET, { method: "POST", path, body: raw }) : {}
  const response = await handler(
    new Request(`http://127.0.0.1:3303${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }),
  )
  return { status: response.status, json: (await response.json()) as Json }
}

const runCheck = (body?: unknown, signed = true) => call(runApi.filesCheckRunPOST, "/api/internal/osbot/files-check/run", body, signed)
const alertCheck = () => call(alertsApi.opsAlertsCheckPOST, "/api/internal/osbot/ops-alerts/check")
const asOwner = async <T>(fn: () => Promise<T>) => actAs((await loadViewer(owner))!, fn)

describe("app.files_storage_inventory()", () => {
  it("lists every account's files for the site owner, naming only the owner's", async () => {
    const rows = await as(owner, (sql) => sql`select owner_id, name, storage_key, size_bytes from app.files_storage_inventory()`)
    const byKey = new Map(rows.map((r) => [r.storage_key, r]))
    expect(byKey.get(ownerOk)).toMatchObject({ owner_id: owner, name: `Tax return ${run}.pdf` })
    expect(byKey.get(aliceOk)).toMatchObject({ owner_id: alice, name: null })
    expect(Number(byKey.get(ownerWrong)!.size_bytes)).toBe(3000)
  })

  it("refuses anyone else, no one, and API tokens", async () => {
    expect(await pgError(as(alice, (sql) => sql`select * from app.files_storage_inventory()`))).toBe("42501")
    expect(await pgError(as(null, (sql) => sql`select * from app.files_storage_inventory()`))).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`select * from app.files_storage_inventory()`, randomUUID()))).toBe("42501")
  })
})

describe("ops_files_check RLS", () => {
  it("keeps each owner's result to themselves", async () => {
    await as(owner, (sql) => sql`insert into ops_files_check (status, checked_at) values ('ok', now())`)
    expect(await as(alice, (sql) => sql`select * from ops_files_check`)).toHaveLength(0)
    expect(await as(owner, (sql) => sql`select * from ops_files_check`)).toHaveLength(1)
    expect(await pgError(as(alice, (sql) => sql`insert into ops_files_check (owner_id, status, checked_at) values (${owner}, 'ok', now())`))).toBe(
      "42501",
    )
    const updated = await as(alice, (sql) => sql`update ops_files_check set status = 'error' where owner_id = ${owner} returning 1`)
    expect(updated).toHaveLength(0)
    // No delete grant at all.
    expect(await pgError(as(owner, (sql) => sql`delete from ops_files_check`))).toBe("42501")
  })
})

describe("files-check/run (osbot)", () => {
  it("refuses unsigned requests", async () => {
    expect((await runCheck({}, false)).status).toBe(401)
  })

  it("compares the bucket with every account's files and stores the result", async () => {
    const { status, json } = await runCheck({ maxAgeHours: 20 })
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: true, ran: true, check: { status: "problems", error: null } })
    const f = json.check.findings
    expect(f).toMatchObject({
      rows: 5,
      objects: 6, // 3 files + Alice's + leftover + fresh + stray, minus nothing: the backup is apart
      ignored: { prefixes: ["postgres/"], objects: 1, bytes: 290_000 },
      missingCount: 2,
      mismatchedCount: 1,
      orphanCount: 2,
      orphanBytes: 7030,
      recent: 1,
    })
    expect(f.objects).toBe(s3.objects.size - 1)
    expect(f.missing.map((m: Json) => [m.key, m.name])).toEqual(
      [
        [ownerLost, `Contract ${run}.pdf`],
        [aliceLost, null],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    )
    expect(f.mismatched).toEqual([expect.objectContaining({ key: ownerWrong, size: 3000, actual: 2500 })])
    expect(f.orphans).toEqual([
      expect.objectContaining({ key: leftover, size: 7000, deletable: true }),
      expect.objectContaining({ key: stray, size: 30, deletable: false }),
    ])

    const [stored] = await admin`select status, findings from ops_files_check where owner_id = ${owner}`
    expect(stored).toMatchObject({ status: "problems", findings: { missingCount: 2 } })

    // A fresh run is enough for osbot's retries: no second listing.
    s3.objects.delete(ownerOk)
    const again = await runCheck({ maxAgeHours: 20 })
    expect(again.json).toMatchObject({ ok: true, ran: false })
    expect(again.json.check.findings.missingCount).toBe(2)
  })

  it("is all good when nothing is wrong", async () => {
    await admin`delete from files_files where storage_key in (${ownerLost}, ${aliceLost}, ${ownerWrong})`
    for (const k of [leftover, stray, ownerWrong]) s3.objects.delete(k)
    const { json } = await runCheck({})
    expect(json.check).toMatchObject({ status: "ok", findings: { missingCount: 0, mismatchedCount: 0, orphanCount: 0, recent: 1 } })
  })

  it("stores a failed listing as an error, never as an empty bucket", async () => {
    s3.failList = Object.assign(new Error("Access Denied"), { $metadata: { httpStatusCode: 403 } })
    const { json } = await runCheck({})
    expect(json.check).toMatchObject({ status: "error", error: "Access Denied (HTTP 403)", findings: null })
  })

  it("says so when there is no storage to check", async () => {
    s3.configured = false
    const { json } = await runCheck({})
    expect(json).toEqual({ ok: false, error: expect.stringContaining("isn't configured") })
    expect(await admin`select 1 from ops_files_check where owner_id = ${owner}`).toHaveLength(0)
  })
})

describe("files server alerts", () => {
  it("raises missing and orphans once each through ops-alerts/check, and can be switched off", async () => {
    await runCheck({})
    const first = await alertCheck()
    expect(first.status).toBe(200)
    const notes = first.json.notifications as Json[]
    expect(notes.map((n) => `${n.event} ${n.key}`).sort()).toEqual(["firing files:missing", "firing files:orphans"])
    const missing = notes.find((n) => n.key === "files:missing")!
    expect(missing).toMatchObject({ kind: "files", title: "Files storage: 2 files missing, 1 file with the wrong size" })
    expect(missing.detail).toContain(`“Contract ${run}.pdf”`)
    expect(missing.detail).toContain("another account's file")
    expect(missing.detail).not.toContain("Alice's secret")

    // Switching the kind off forgets them.
    await as(owner, (sql) => sql`insert into ops_alert_settings (disabled_kinds) values (array['files'])`)
    expect((await alertCheck()).json.notifications).toEqual([])
  })

  it("raises a failed run as files:check", async () => {
    s3.failList = new Error("getaddrinfo ENOTFOUND nbg1.example")
    await runCheck({})
    const { json } = await alertCheck()
    expect(json.notifications).toEqual([
      expect.objectContaining({ key: "files:check", kind: "files", title: "Files storage check failed", event: "firing" }),
    ])
  })
})

describe("delete orphans", () => {
  it("deletes only what is still an old orphan with a Files key, then checks again", async () => {
    await asOwner(() => runFilesCheck({}))
    // Between the check and the click, the leftover got its row after all.
    const late = key(owner)
    s3.objects.set(late, { size: 10, lastModified: hoursAgo(30) })
    await admin`
      insert into files_files (owner_id, name, size_bytes, mime, storage_key)
      values (${owner}, 'Late.pdf', 10, 'application/pdf', ${late})`
    const [lateRow] = await admin`select id from files_files where storage_key = ${late}`
    fileIds.push(lateRow!.id)

    const result = await asOwner(() => deleteOrphans({ keys: [leftover, stray, fresh, late, backup, ownerOk] }))
    expect(result).toMatchObject({ ok: true, deleted: 1, skipped: 5 })
    expect(s3.deleted).toEqual([leftover])
    for (const k of [stray, fresh, late, backup, ownerOk]) expect(s3.objects.has(k)).toBe(true)
    if (result.ok) expect(result.check.findings!.orphans.map((o) => o.key)).toEqual([stray])
  })

  it("is the owner's alone", async () => {
    await expect(actAs((await loadViewer(alice))!, () => deleteOrphans({ keys: [leftover] }))).rejects.toThrow(/owner/)
    expect(s3.deleted).toEqual([])
  })
})
