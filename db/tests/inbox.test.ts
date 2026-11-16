// RLS for inbox_items: `pnpm test:db`. Same harness as rls.test.ts.
// The inbox is strictly private; items must carry text or a web URL.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-alice-${run}`
const bob = `test-bob-${run}`

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

let item = ""

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await admin`
      insert into auth."user" (id, name, email, email_verified)
      values (${id}, ${id}, ${`${id}@test.local`}, true)`
  }
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("inbox_items", () => {
  it("captures an item for the viewer, unprocessed, from the app by default", async () => {
    const [row] = await as(alice, (sql) => sql`
      insert into inbox_items (text, url) values (${`Read this ${run}`}, 'https://example.com/a')
      returning id, owner_id, source, processed_at`)
    expect(row).toMatchObject({ owner_id: alice, source: "app", processed_at: null })
    item = row!.id
  })

  it("hides the inbox from other users and anonymous sessions", async () => {
    const bobSees = await as(bob, (sql) => sql`select count(*)::int as n from inbox_items where owner_id = ${alice}`)
    expect(bobSees[0]!.n).toBe(0)
    const anon = await as(null, (sql) => sql`select count(*)::int as n from inbox_items`)
    expect(anon[0]!.n).toBe(0)
  })

  it("never lets anyone else process or delete the owner's items", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`
        update inbox_items set processed_at = now(), processed_as = 'task' where id = ${item}`
      const deleted = await sql`delete from inbox_items where id = ${item}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
  })

  it("refuses anonymous inserts and handing an item to someone else", async () => {
    expect(await pgError(as(null, (sql) => sql`insert into inbox_items (text) values ('anon')`))).toBe("42501")
    expect(
      await pgError(as(alice, (sql) => sql`update inbox_items set owner_id = ${bob} where id = ${item}`)),
    ).toBe("42501")
  })

  it("refuses empty items, non-web URLs, unknown sources and half-processed rows", async () => {
    const bad = [
      as(alice, (sql) => sql`insert into inbox_items (text) values ('   ')`),
      as(alice, (sql) => sql`insert into inbox_items (text, url) values ('x', 'javascript:alert(1)')`),
      as(alice, (sql) => sql`insert into inbox_items (text, source) values ('x', 'email')`),
      as(alice, (sql) => sql`insert into inbox_items (text, processed_as) values ('x', 'task')`),
      as(alice, (sql) => sql`insert into inbox_items (text, processed_at, processed_as) values ('x', now(), 'tweet')`),
    ]
    for (const attempt of bad) expect(await pgError(attempt)).toBe("23514")
  })

  it("lets the owner process an item", async () => {
    const [row] = await as(alice, (sql) => sql`
      update inbox_items set processed_at = now(), processed_as = 'link' where id = ${item}
      returning processed_as`)
    expect(row).toEqual({ processed_as: "link" })
  })
})
