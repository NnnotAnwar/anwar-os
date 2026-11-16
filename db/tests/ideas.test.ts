// RLS for ideas_ideas: `pnpm test:db`. Same harness as rls.test.ts.
// Ideas are private unless the site owner publishes them.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-bob-${run}`
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
})

afterAll(async () => {
  await admin`delete from ideas_ideas where title like ${`%${run}`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort()

describe("ideas_ideas", () => {
  it("starts an idea as raw and private", async () => {
    const [idea] = await as(owner, (sql) => sql`
      insert into ideas_ideas (title) values (${`private ${run}`}) returning owner_id, status, is_public`)
    expect(idea).toEqual({ owner_id: owner, status: "raw", is_public: false })
    await as(owner, (sql) => sql`
      insert into ideas_ideas (title, status, is_public) values (${`public ${run}`}, 'building', true)`)
  })

  it("shows anonymous visitors only the site owner's published ideas", async () => {
    await as(bob, (sql) => sql`insert into ideas_ideas (title, is_public) values (${`bob public ${run}`}, true)`)
    const rows = await as(null, (sql) => sql`select title from ideas_ideas where title like ${`%${run}`}`)
    expect(titles(rows as never)).toEqual([`public ${run}`])
  })

  it("hides the owner's private ideas from other users", async () => {
    const rows = await as(bob, (sql) => sql`select title from ideas_ideas where title like ${`%${run}`}`)
    expect(titles(rows as never)).toEqual([`bob public ${run}`, `public ${run}`])
  })

  it("never lets anyone else edit or delete the owner's ideas", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`update ideas_ideas set is_public = true where owner_id = ${owner}`
      const deleted = await sql`delete from ideas_ideas where owner_id = ${owner}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
  })

  it("refuses anonymous inserts and unknown statuses", async () => {
    expect(await pgError(as(null, (sql) => sql`insert into ideas_ideas (title) values (${`anon ${run}`})`))).toBe(
      "42501",
    )
    expect(
      await pgError(as(owner, (sql) => sql`insert into ideas_ideas (title, status) values (${`bad ${run}`}, 'done')`)),
    ).toBe("23514")
  })

  it("refuses handing an idea to someone else", async () => {
    const code = await pgError(as(owner, (sql) => sql`
      update ideas_ideas set owner_id = ${bob} where title = ${`private ${run}`}`))
    expect(code).toBe("42501")
  })
})
