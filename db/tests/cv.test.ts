// RLS for the cv_* tables: `pnpm test:db`. Same harness as rls.test.ts.
// The CV is public only while the site owner's profile is published, and then
// only the entries marked visible.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const bob = `test-bob-${run}`
let owner = ""
let createdOwner = false
let ownerHadProfile = false
let ownerWasPublic = false

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

const anonRoles = () =>
  as(null, (sql) => sql<{ role: string }[]>`select role from cv_experience where role like ${`%${run}`} order by role`)

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
  const [existing] = await admin<{ is_public: boolean }[]>`select is_public from cv_profile where owner_id = ${owner}`
  ownerHadProfile = Boolean(existing)
  ownerWasPublic = existing?.is_public ?? false
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
})

afterAll(async () => {
  await admin`delete from cv_experience where role like ${`%${run}`}`
  await admin`delete from cv_languages where name like ${`%${run}`}`
  if (ownerHadProfile) await admin`update cv_profile set is_public = ${ownerWasPublic} where owner_id = ${owner}`
  else await admin`delete from cv_profile where owner_id = ${owner}`
  await admin`delete from auth."user" where id = ${bob}`
  if (createdOwner) await admin`delete from auth."user" where id = ${owner}`
  await Promise.all([admin.end(), app.end()])
})

describe("cv tables", () => {
  it("gives each owner at most one profile, unpublished by default", async () => {
    if (!ownerHadProfile) {
      const [profile] = await as(owner, (sql) => sql`insert into cv_profile (headline) values ('Test') returning is_public`)
      expect(profile!.is_public).toBe(false)
    }
    expect(await pgError(as(owner, (sql) => sql`insert into cv_profile (headline) values ('Second')`))).toBe("23505")
  })

  it("hides every entry while the profile is unpublished", async () => {
    await as(owner, (sql) => sql`update cv_profile set is_public = false`)
    await as(owner, (sql) => sql`
      insert into cv_experience (role, is_public)
      values (${`visible ${run}`}, true), (${`hidden ${run}`}, false)`)
    expect(await anonRoles()).toEqual([])
    const profiles = await as(null, (sql) => sql`select 1 from cv_profile where owner_id = ${owner}`)
    expect(profiles).toHaveLength(0)
  })

  it("shows the published profile and its visible entries only", async () => {
    await as(owner, (sql) => sql`update cv_profile set is_public = true`)
    expect((await anonRoles()).map((r) => r.role)).toEqual([`visible ${run}`])
    const profiles = await as(null, (sql) => sql`select 1 from cv_profile where owner_id = ${owner}`)
    expect(profiles).toHaveLength(1)
  })

  it("is what the public /cv read returns (readCv for the site owner, no viewer)", async () => {
    // Regression: readCv filtered on the current user, which a visitor doesn't
    // have, so /cv said "not public yet" for a published CV.
    process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3303"
    const { asPublic } = await import("@/db")
    const { readCv } = await import("@/modules/cv/actions")
    const cv = await asPublic((tx) => readCv(tx, "site owner"))
    expect(cv.profile).not.toBeNull()
    expect(cv.experience.map((e) => e.role).filter((r) => r.endsWith(run))).toEqual([`visible ${run}`])
    // The private read stays "mine": a visitor has nothing of their own.
    expect((await asPublic((tx) => readCv(tx))).profile).toBeNull()
  })

  it("never shows another user's published CV publicly", async () => {
    await as(bob, async (sql) => {
      await sql`insert into cv_profile (headline, is_public) values ('Bob', true)`
      await sql`insert into cv_languages (name) values (${`bob lang ${run}`})`
    })
    const profiles = await as(null, (sql) => sql`select 1 from cv_profile where owner_id = ${bob}`)
    const languages = await as(null, (sql) => sql`select 1 from cv_languages where name like ${`%${run}`}`)
    expect(profiles).toHaveLength(0)
    expect(languages).toHaveLength(0)
  })

  it("hides the owner's hidden entries from other users and blocks their writes", async () => {
    const rows = await as(bob, (sql) => sql`select role from cv_experience where role like ${`%${run}`}`)
    expect(rows.map((r) => r.role)).toEqual([`visible ${run}`])
    const result = await as(bob, async (sql) => {
      const updated = await sql`update cv_experience set role = 'hijacked' where owner_id = ${owner}`
      const profile = await sql`update cv_profile set headline = 'hijacked' where owner_id = ${owner}`
      const deleted = await sql`delete from cv_experience where owner_id = ${owner}`
      return { updated: updated.count, profile: profile.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, profile: 0, deleted: 0 })
  })

  it("refuses anonymous writes", async () => {
    expect(await pgError(as(null, (sql) => sql`insert into cv_experience (role) values (${`anon ${run}`})`))).toBe(
      "42501",
    )
  })
})
