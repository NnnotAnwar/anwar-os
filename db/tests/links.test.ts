// Row-level security for links_links: `pnpm test:db`. Same harness as
// rls.test.ts: `admin` sets up fixtures, `app` connects as os_app.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-links-bob-${run}`
const marker = `https://links-test-${run}.example`
/** The site owner: the real one if this database has one, else a temporary one. */
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

beforeAll(async () => {
  const [row] = await admin`select app.site_owner_id() as id`
  if (row?.id) {
    owner = row.id
  } else {
    owner = `test-links-owner-${run}`
    createdOwner = true
    await admin`
      insert into auth."user" (id, name, email, email_verified, role)
      values (${owner}, 'Owner', ${`${owner}@test.local`}, true, 'owner')`
  }
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`

  await as(owner, (sql) => sql`
    insert into links_links (url, title, is_public)
    values (${`${marker}/owner-public`}, 'owner public', true),
           (${`${marker}/owner-private`}, 'owner private', false)`)
  await as(bob, (sql) => sql`
    insert into links_links (url, title, is_public)
    values (${`${marker}/bob-public`}, 'bob public', true)`)
})

afterAll(async () => {
  await admin`delete from links_links where url like ${`${marker}%`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

const mine = (sql: postgres.TransactionSql) =>
  sql`select title, owner_id from links_links where url like ${`${marker}%`} order by title`

describe("links_links", () => {
  it("defaults owner_id to the viewer", async () => {
    const [row] = await as(bob, (sql) =>
      sql`insert into links_links (url, title) values (${`${marker}/bob-2`}, 'bob 2') returning owner_id`,
    )
    expect(row!.owner_id).toBe(bob)
  })

  it("refuses a link saved on someone else's behalf", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into links_links (owner_id, url, title) values (${owner}, ${`${marker}/x`}, 'x')`),
    )
    expect(code).toBe("42501")
  })

  it("shows visitors only the site owner's published links", async () => {
    const rows = await as(null, mine)
    expect(rows.map((r) => r.title)).toEqual(["owner public"])
  })

  it("never publishes another user's public links", async () => {
    const rows = await as(null, mine)
    expect(rows.some((r) => r.owner_id === bob)).toBe(false)
  })

  it("hides the owner's private links from other users", async () => {
    const rows = await as(bob, mine)
    expect(rows.map((r) => r.title)).not.toContain("owner private")
  })

  it("lets the owner see all of their own links", async () => {
    const rows = await as(owner, mine)
    expect(rows.map((r) => r.title)).toEqual(expect.arrayContaining(["owner private", "owner public"]))
  })

  it("makes published links read-only for everyone but their owner", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`update links_links set title = 'hijacked' where owner_id = ${owner}`
      const deleted = await sql`delete from links_links where owner_id = ${owner}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
    const anonymous = await as(null, async (sql) => {
      const updated = await sql`update links_links set title = 'hijacked'`
      return updated.count
    })
    expect(anonymous).toBe(0)
  })

  it("refuses handing a link to someone else", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`update links_links set owner_id = ${owner} where url = ${`${marker}/bob-public`}`),
    )
    expect(code).toBe("42501")
  })

  it("accepts only http(s) URLs", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into links_links (url, title) values ('javascript:alert(1)', 'x')`),
    )
    expect(code).toBe("23514")
  })

  it("keeps one row per URL per owner", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into links_links (url, title) values (${`${marker}/bob-public`}, 'again')`),
    )
    expect(code).toBe("23505")
  })

  it("keeps updated_at current through the trigger", async () => {
    const url = `${marker}/bob-public`
    const [before] = await as(bob, (sql) => sql`select updated_at from links_links where url = ${url}`)
    await new Promise((r) => setTimeout(r, 20))
    const [after] = await as(bob, (sql) => sql`update links_links set note = 'n' where url = ${url} returning updated_at`)
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime())
  })
})
