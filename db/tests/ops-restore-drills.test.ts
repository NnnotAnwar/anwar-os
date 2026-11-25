// Restore drills: `pnpm test:db`. RLS on ops_restore_drills, and the signed
// endpoints the GitHub Actions drill calls (/api/ops/restore-drill/source and
// /report) end to end, with object storage faked (the listing and the
// presigned URL); then the "drill" server alert from what was stored.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { signedHeaders } from "@/lib/signed-request"

const connection = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}))

// Object storage: a few objects under the backup prefix, and a fake presigner.
const objects = vi.hoisted(() => ({ list: [] as { key: string; size: number; lastModified: Date | null }[], listed: [] as unknown[] }))
vi.mock("@/modules/files/lib/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/files/lib/s3")>()),
  storageConfigured: () => true,
  listObjects: async function* (opts: { prefix?: string; bucket?: string }) {
    objects.listed.push(opts)
    for (const o of objects.list) if (o.key.startsWith(opts.prefix ?? "")) yield o
  },
  presignGet: async (key: string, ttl: number, bucket?: string) => `https://s3.test/${bucket ?? "files"}/${key}?ttl=${ttl}`,
}))

const SECRET = `drill-test-${randomBytes(24).toString("hex")}`
process.env.RESTORE_DRILL_SECRET = SECRET
process.env.BACKUP_PREFIX = "postgres"
process.env.BACKUP_S3_BUCKET = "anwar-os-backups"
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3303"
delete process.env.OPS_AGENT_URL

const api = await import("@/modules/ops/restore-drill-api")
const { drillAlerts } = await import("@/modules/ops/lib/drill")

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-drill-bob-${run}`
let owner = ""
let createdOwner = false
let saved: Record<string, unknown>[] = []

function as<T>(viewer: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (viewer) await sql`select set_config('app.user_id', ${viewer}, true)`
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

beforeAll(async () => {
  const [o] = await admin<{ id: string | null }[]>`select app.site_owner_id() as id`
  if (o?.id) {
    owner = o.id
  } else {
    owner = `test-drill-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`insert into auth."user" (id, name, email, email_verified) values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  // Keep the owner's real drills aside, restore them after.
  saved = await admin`select * from ops_restore_drills where owner_id = ${owner}`
  await admin`delete from ops_restore_drills where owner_id = ${owner}`
})

afterAll(async () => {
  await admin`delete from ops_restore_drills where owner_id = ${owner}`
  for (const r of saved) await admin`insert into ops_restore_drills ${admin(r)}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(handler: (r: Request) => Promise<Response>, path: string, body?: unknown, secret: string | null = SECRET) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  const headers = secret ? signedHeaders(secret, { method: "POST", path, body: raw }, api.DRILL_SIGNATURE_HEADERS) : {}
  const response = await handler(
    new Request(`http://127.0.0.1:3303${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }),
  )
  return { status: response.status, json: (await response.json()) as Json }
}

const report = (body: unknown, secret?: string | null) => call(api.drillReportPOST, "/api/ops/restore-drill/report", body, secret)
const source = () => call(api.drillSourcePOST, "/api/ops/restore-drill/source")

const okReport = (finishedAt: string, tables: Record<string, number> = { "auth.user": 1, "public.notes_notes": 40 }) => ({
  status: "ok",
  startedAt: new Date(new Date(finishedAt).getTime() - 134_000).toISOString(),
  finishedAt,
  durationMs: 134_000,
  backup: { file: "anwar_os-2026-12-01T021503Z.dump.age", at: "2026-12-01T02:15:03Z", bytes: 335833 },
  totalRows: Object.values(tables).reduce((a, b) => a + b, 0),
  tables,
  checks: [{ name: "restore", ok: true, detail: "pg_restore exited 0" }],
  runUrl: "https://github.com/NnnotAnwar/anwar-os/actions/runs/1",
  commit: "52a5e91",
})

describe("restore drill API", () => {
  it("refuses unsigned or wrongly signed calls", async () => {
    expect((await report(okReport("2026-12-01T04:02:14Z"), null)).status).toBe(401)
    expect((await report(okReport("2026-12-01T04:02:14Z"), "x".repeat(64))).status).toBe(401)
    expect((await call(api.drillSourcePOST, "/api/ops/restore-drill/source", undefined, null)).status).toBe(401)
  })

  it("is off without the secret", async () => {
    delete process.env.RESTORE_DRILL_SECRET
    try {
      expect((await report(okReport("2026-12-01T04:02:14Z"))).status).toBe(404)
    } finally {
      process.env.RESTORE_DRILL_SECRET = SECRET
    }
  })

  it("hands out a short-lived link to the newest daily backup, with the last good drill's counts", async () => {
    objects.list = [
      { key: "postgres/daily/anwar_os-2026-11-30T021503Z.dump.age", size: 300_000, lastModified: new Date("2026-11-30T02:15:04Z") },
      { key: "postgres/daily/anwar_os-2026-12-01T021503Z.dump.age", size: 335_833, lastModified: new Date("2026-12-01T02:15:04Z") },
      { key: "postgres/daily/notes.txt", size: 1, lastModified: null },
      { key: "postgres/weekly/anwar_os-2026-W49.dump.age", size: 1, lastModified: null },
    ]
    const first = await source()
    expect(first).toMatchObject({
      status: 200,
      json: {
        url: "https://s3.test/anwar-os-backups/postgres/daily/anwar_os-2026-12-01T021503Z.dump.age?ttl=900",
        expiresIn: 900,
        file: "anwar_os-2026-12-01T021503Z.dump.age",
        bytes: 335_833,
        lastModified: "2026-12-01T02:15:04.000Z",
        previous: null,
      },
    })
    expect(objects.listed.at(-1)).toEqual({ prefix: "postgres/daily/", bucket: "anwar-os-backups" })

    expect((await report(okReport("2026-12-01T04:02:14Z"))).status).toBe(200)
    const second = await source()
    expect(second.json.previous).toMatchObject({ totalRows: 41, tables: { "auth.user": 1, "public.notes_notes": 40 } })
  })

  it("says so when there is no backup", async () => {
    objects.list = []
    expect(await source()).toMatchObject({ status: 404, json: { error: "no_backup" } })
  })

  it("validates reports", async () => {
    const bad = await report({ ...okReport("2026-12-01T04:02:14Z"), tables: { "x; drop table": 1 } })
    expect(bad.status).toBe(400)
    expect((await report({ ...okReport("2026-12-01T04:02:14Z"), status: "great" })).status).toBe(400)
  })

  it("stores reports and keeps the newest 24", async () => {
    await admin`delete from ops_restore_drills where owner_id = ${owner}`
    for (let i = 0; i < 26; i++) {
      const at = new Date(Date.UTC(2026, 0, 1 + i, 4)).toISOString()
      expect((await report(okReport(at))).status).toBe(200)
    }
    const rows = await admin<{ finished_at: Date }[]>`select finished_at from ops_restore_drills where owner_id = ${owner} order by finished_at`
    expect(rows).toHaveLength(24)
    expect(rows[0]!.finished_at.toISOString()).toBe("2026-01-03T04:00:00.000Z")
  })

  it("a failed drill becomes a server alert", async () => {
    const failed = {
      ...okReport(new Date().toISOString()),
      status: "failed",
      checks: [{ name: "rls", ok: false, detail: "public.x has no policies" }],
    }
    expect((await report(failed)).status).toBe(200)
    const { getDrillState } = await import("@/modules/ops/restore-drill")
    const { actAs, loadViewer } = await import("@/core/auth")
    const viewer = (await loadViewer(owner))!
    const state = await actAs(viewer, () => getDrillState())
    expect(state.latest?.status).toBe("failed")
    expect(state.lastOk?.status).toBe("ok")
    expect(drillAlerts(state, new Date())[0]).toMatchObject({ key: "drill", title: "Restore drill failed" })
  })
})

describe("RLS on ops_restore_drills", () => {
  it("only the owner sees and prunes their drills; nobody edits one", async () => {
    expect((await as(owner, (sql) => sql`select id from ops_restore_drills`)).length).toBeGreaterThan(0)
    expect(await as(bob, (sql) => sql`select id from ops_restore_drills`)).toHaveLength(0)
    expect(await as(null, (sql) => sql`select id from ops_restore_drills`)).toHaveLength(0)
    expect(await as(bob, (sql) => sql`delete from ops_restore_drills returning id`)).toHaveLength(0)
    expect(await pgError(as(owner, (sql) => sql`update ops_restore_drills set status = 'ok'`))).toBe("42501")
    expect(
      await pgError(
        as(bob, (sql) => sql`
          insert into ops_restore_drills (owner_id, status, started_at, finished_at)
          values (${owner}, 'ok', now(), now())`),
      ),
    ).toBe("42501")
  })
})
