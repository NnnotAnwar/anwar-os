// Cookie-free analytics: `pnpm test:db`. Same harness as rls.test.ts.
// Anonymous visitors can only count a view through app.record_page_view(),
// which validates everything; only the owner reads the counters.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-bob-${run}`
const slug = `analytics-${run}`
let owner = ""
let createdOwner = false

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

const view = (path: string, referrer = "", device = "desktop", country = "") =>
  as(null, (sql) => sql<{ counted: boolean }[]>`
    select app.record_page_view(${path}, ${referrer}, ${device}, ${country}) as counted`).then((r) => r[0]!.counted)

const views = (viewer: string | null, path: string) =>
  as(viewer, (sql) => sql<{ n: number }[]>`
    select coalesce(sum(views), 0)::int as n from analytics_daily where path = ${path}`).then((r) => r[0]!.n)

beforeAll(async () => {
  const [row] = await admin<{ id: string | null }[]>`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
  await admin`
    insert into notes_notes (owner_id, title, is_public, slug, published_at)
    values (${owner}, ${`published ${run}`}, true, ${slug}, now()),
           (${owner}, ${`draft ${run}`}, false, ${`${slug}-draft`}, null)`
})

afterAll(async () => {
  await admin`delete from analytics_daily where path like ${`%${run}%`} or referrer_host = ${`${run}.example.com`}`
  await admin`delete from notes_notes where title like ${`%${run}`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("app.record_page_view", () => {
  it("counts a visitor's view of a published note for the site owner, as a daily counter", async () => {
    const path = `/writing/${slug}`
    expect(await view(path, `${run}.example.com`, "mobile", "CZ")).toBe(true)
    expect(await view(path, `${run}.example.com`, "mobile", "CZ")).toBe(true)
    const rows = await admin`
      select owner_id, day = (now() at time zone 'utc')::date as today, referrer_host, device, country, views
        from analytics_daily where path = ${path}`
    expect(rows).toEqual([
      { owner_id: owner, today: true, referrer_host: `${run}.example.com`, device: "mobile", country: "CZ", views: 2 },
    ])
  })

  it("counts sections and known tools", async () => {
    expect(await view("/")).toBe(true)
    expect(await view("/tools/calories")).toBe(true)
  })

  it("drops views of drafts and unknown slugs without an error", async () => {
    expect(await view(`/writing/${slug}-draft`)).toBe(false)
    expect(await view(`/projects/no-such-project-${run}`)).toBe(false)
  })

  it("refuses paths outside the public site and malformed fields", async () => {
    for (const path of ["/app", "/app/notes", "/login", "/api/a", "/cv?x=1", "/tools/unknown", "/writing/Bad_Slug", "", "x"]) {
      expect(await pgError(view(path)), path).toBe("22023")
    }
    expect(await pgError(view("/cv", "not a host"))).toBe("22023")
    expect(await pgError(view("/cv", "", "fridge"))).toBe("22023")
    expect(await pgError(view("/cv", "", "desktop", "Czechia"))).toBe("22023")
  })

  it("drops views once the minute's global budget is spent", async () => {
    await admin`
      insert into analytics_rate (minute, hits) values (date_trunc('minute', now()), 600)
      on conflict (minute) do update set hits = 600`
    try {
      expect(await view(`/writing/${slug}`)).toBe(false)
    } finally {
      await admin`delete from analytics_rate`
    }
  })
})

describe("analytics tables", () => {
  it("are readable by the owner only", async () => {
    const path = `/writing/${slug}`
    expect(await views(owner, path)).toBe(2)
    expect(await views(bob, path)).toBe(0)
    expect(await views(null, path)).toBe(0)
  })

  it("can't be written or read around the function", async () => {
    expect(
      await pgError(as(null, (sql) => sql`
        insert into analytics_daily (owner_id, day, path, device, views)
        values (${owner}, current_date, ${`/writing/${slug}`}, 'desktop', 1000)`)),
    ).toBe("42501")
    expect(
      await pgError(as(owner, (sql) => sql`update analytics_daily set views = 1000 where path = ${`/writing/${slug}`}`)),
    ).toBe("42501")
    expect(await pgError(as(owner, (sql) => sql`delete from analytics_daily`))).toBe("42501")
    expect(await pgError(as(null, (sql) => sql`select * from analytics_rate`))).toBe("42501")
    expect(await pgError(as(null, (sql) => sql`insert into analytics_rate (minute, hits) values (now(), 0)`))).toBe("42501")
  })
})
