// RLS for publishing notes on /writing: `pnpm test:db`. Same harness as rls.test.ts.
// Notes stay private unless the site owner publishes them; a published note of
// any other user never shows publicly.
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
  await admin`delete from notes_notes where title like ${`%${run}`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort()

describe("notes_notes publishing", () => {
  it("starts a note private, with no address", async () => {
    const [note] = await as(owner, (sql) => sql`
      insert into notes_notes (title) values (${`private ${run}`}) returning is_public, slug, published_at`)
    expect(note).toEqual({ is_public: false, slug: null, published_at: null })
  })

  it("publishes only with an address and a date", async () => {
    expect(
      await pgError(as(owner, (sql) => sql`insert into notes_notes (title, is_public) values (${`no slug ${run}`}, true)`)),
    ).toBe("23514")
    await as(owner, (sql) => sql`
      insert into notes_notes (title, is_public, slug, published_at)
      values (${`public ${run}`}, true, ${`public-${run}`}, now())`)
  })

  it("refuses malformed and duplicate addresses for one owner", async () => {
    expect(
      await pgError(as(owner, (sql) => sql`
        insert into notes_notes (title, slug) values (${`bad ${run}`}, ${"Not A Slug"})`)),
    ).toBe("23514")
    expect(
      await pgError(as(owner, (sql) => sql`
        insert into notes_notes (title, slug) values (${`dupe ${run}`}, ${`public-${run}`})`)),
    ).toBe("23505")
  })

  it("shows anonymous visitors only the site owner's published notes", async () => {
    await as(bob, (sql) => sql`
      insert into notes_notes (title, is_public, slug, published_at)
      values (${`bob public ${run}`}, true, ${`bob-${run}`}, now())`)
    const rows = await as(null, (sql) => sql`select title from notes_notes where title like ${`%${run}`}`)
    expect(titles(rows as never)).toEqual([`public ${run}`])
  })

  it("lets other users see the owner's published notes but never the private ones", async () => {
    const rows = await as(bob, (sql) => sql`select title from notes_notes where title like ${`%${run}`}`)
    expect(titles(rows as never)).toEqual([`bob public ${run}`, `public ${run}`])
    // What the app's "mine" filter returns for Bob: his own notes only.
    const mine = await as(bob, (sql) => sql`
      select title from notes_notes where owner_id = app.current_user_id() and title like ${`%${run}`}`)
    expect(titles(mine as never)).toEqual([`bob public ${run}`])
  })

  it("hides a note from visitors as soon as it's unpublished", async () => {
    await as(owner, (sql) => sql`update notes_notes set is_public = false where title = ${`public ${run}`}`)
    const rows = await as(null, (sql) => sql`select title from notes_notes where title like ${`%${run}`}`)
    expect(rows).toHaveLength(0)
    await as(owner, (sql) => sql`update notes_notes set is_public = true where title = ${`public ${run}`}`)
  })

  it("never lets visitors or other users write the owner's notes", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`update notes_notes set title = 'hijacked' where owner_id = ${owner}`
      const deleted = await sql`delete from notes_notes where owner_id = ${owner}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
    expect(await pgError(as(null, (sql) => sql`insert into notes_notes (title) values (${`anon ${run}`})`))).toBe("42501")
    const anon = await as(null, (sql) => sql`update notes_notes set title = 'x' where owner_id = ${owner}`)
    expect(anon.count).toBe(0)
  })
})
