// RLS for core_preferences (the "My services" selection): `pnpm test:db`.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-pref-alice-${run}`
const bob = `test-pref-bob-${run}`

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
  await admin`
    insert into auth."user" (id, name, email, email_verified)
    values (${alice}, 'Alice', ${`${alice}@test.local`}, true),
           (${bob}, 'Bob', ${`${bob}@test.local`}, true)`
})

afterAll(async () => {
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("core_preferences", () => {
  it("lets a user save and re-save their own selection (upsert)", async () => {
    await as(alice, (sql) => sql`
      insert into core_preferences (pinned_services) values (${["notes", "calendar"]})
      on conflict (owner_id) do update set pinned_services = excluded.pinned_services`)
    await as(alice, (sql) => sql`
      insert into core_preferences (pinned_services) values (${["ideas"]})
      on conflict (owner_id) do update set pinned_services = excluded.pinned_services`)
    const [row] = await as(alice, (sql) => sql`select pinned_services from core_preferences`)
    expect(row!.pinned_services).toEqual(["ideas"])
  })

  it("hides and protects other users' selections", async () => {
    const rows = await as(bob, (sql) => sql`select owner_id from core_preferences`)
    expect(rows).toHaveLength(0)
    const updated = await as(bob, (sql) => sql`update core_preferences set pinned_services = '{}'`)
    expect(updated.count).toBe(0)
  })

  it("refuses writing a row for someone else", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into core_preferences (owner_id, pinned_services) values (${alice}, '{}')`),
    )
    expect(code).toBe("42501")
  })

  it("can't delete rows directly", async () => {
    const code = await pgError(as(alice, (sql) => sql`delete from core_preferences`))
    expect(code).toBe("42501")
  })
})
