// RLS for projects_projects: `pnpm test:db`. Same harness as rls.test.ts.
// The public site shows the site owner's published projects; nothing else.
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
  // Use the real site owner if one exists (local dev), otherwise create one.
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
  await admin`delete from projects_projects where slug like ${`%-${run}`}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("projects_projects", () => {
  it("lets the owner create projects; owner_id defaults to the viewer", async () => {
    const rows = await as(owner, (sql) => sql`
      insert into projects_projects (title, slug, is_public)
      values ('Published', ${`published-${run}`}, true),
             ('Draft', ${`draft-${run}`}, false)
      returning owner_id`)
    expect(rows.map((r) => r.owner_id)).toEqual([owner, owner])
  })

  it("shows anonymous visitors only the site owner's published projects", async () => {
    await as(bob, (sql) => sql`
      insert into projects_projects (title, slug, is_public) values ('Bob public', ${`bob-${run}`}, true)`)
    const rows = await as(null, (sql) => sql`
      select slug from projects_projects where slug like ${`%-${run}`} order by slug`)
    expect(rows.map((r) => r.slug)).toEqual([`published-${run}`])
  })

  it("hides the owner's drafts from other signed-in users", async () => {
    const rows = await as(bob, (sql) => sql`
      select slug from projects_projects where slug like ${`%-${run}`} order by slug`)
    expect(rows.map((r) => r.slug)).toEqual([`bob-${run}`, `published-${run}`])
  })

  it("never lets anyone else change or delete a published project", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`update projects_projects set title = 'hijacked' where slug = ${`published-${run}`}`
      const deleted = await sql`delete from projects_projects where slug = ${`published-${run}`}`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
    const anon = await as(null, (sql) => sql`update projects_projects set title = 'hijacked'`)
    expect(anon.count).toBe(0)
  })

  it("refuses anonymous inserts and inserts on someone else's behalf", async () => {
    expect(await pgError(as(null, (sql) => sql`
      insert into projects_projects (title, slug) values ('x', ${`anon-${run}`})`))).toBe("42501")
    expect(await pgError(as(bob, (sql) => sql`
      insert into projects_projects (owner_id, title, slug) values (${owner}, 'x', ${`forged-${run}`})`))).toBe("42501")
  })

  it("keeps slugs unique per owner and URL-safe", async () => {
    expect(await pgError(as(owner, (sql) => sql`
      insert into projects_projects (title, slug) values ('Again', ${`draft-${run}`})`))).toBe("23505")
    expect(await pgError(as(owner, (sql) => sql`
      insert into projects_projects (title, slug) values ('Bad', ${`Bad Slug ${run}`})`))).toBe("23514")
  })

  it("keeps updated_at current through the trigger", async () => {
    const [before] = await as(owner, (sql) => sql`select updated_at from projects_projects where slug = ${`draft-${run}`}`)
    await new Promise((r) => setTimeout(r, 20))
    const [after] = await as(owner, (sql) => sql`
      update projects_projects set summary = 'edited' where slug = ${`draft-${run}`} returning updated_at`)
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime())
  })
})
