// Row-level security tests against a real Postgres: `pnpm test:db`.
// `admin` (migration role) sets up fixtures; `app` connects as os_app, exactly
// like the web app, and tries to break the rules.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-alice-${run}`
const bob = `test-bob-${run}`

/** One transaction as os_app with the given viewer (or none). */
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
  // Cascades to their notes.
  await admin`delete from auth."user" where id in (${alice}, ${bob})`
  await Promise.all([admin.end(), app.end()])
})

describe("the app role", () => {
  it("is neither superuser nor able to bypass RLS", async () => {
    const [role] = await app`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false })
  })

  it("cannot create users (sign-ups go through the owner script only)", async () => {
    const code = await pgError(app`insert into auth."user" (id, name, email) values ('x', 'x', 'x@test.local')`)
    expect(code).toBe("42501")
  })

  it("cannot change anyone's role, including its own", async () => {
    const code = await pgError(as(alice, (sql) => sql`update auth."user" set role = 'owner' where id = ${alice}`))
    expect(code).toBe("42501")
  })

  it("cannot create tables in public", async () => {
    const code = await pgError(app`create table public.sneaky (id int)`)
    expect(code).toBe("42501")
  })
})

describe("notes_notes", () => {
  it("lets a user create a note; owner_id defaults to the viewer", async () => {
    const [note] = await as(alice, (sql) => sql`insert into notes_notes (title) values ('alice note') returning owner_id`)
    expect(note!.owner_id).toBe(alice)
  })

  it("refuses a note created on someone else's behalf", async () => {
    const code = await pgError(
      as(alice, (sql) => sql`insert into notes_notes (owner_id, title) values (${bob}, 'forged')`),
    )
    expect(code).toBe("42501")
  })

  it("hides other users' notes", async () => {
    const rows = await as(bob, (sql) => sql`select id from notes_notes`)
    expect(rows).toHaveLength(0)
  })

  it("makes other users' notes impossible to update or delete", async () => {
    const result = await as(bob, async (sql) => {
      const updated = await sql`update notes_notes set title = 'hijacked'`
      const deleted = await sql`delete from notes_notes`
      return { updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ updated: 0, deleted: 0 })
    const [note] = await as(alice, (sql) => sql`select title from notes_notes`)
    expect(note!.title).toBe("alice note")
  })

  it("refuses handing a note to someone else", async () => {
    const code = await pgError(as(alice, (sql) => sql`update notes_notes set owner_id = ${bob}`))
    expect(code).toBe("42501")
  })

  it("shows nothing and accepts nothing without a viewer", async () => {
    const rows = await as(null, (sql) => sql`select id from notes_notes`)
    expect(rows).toHaveLength(0)
    // owner_id falls back to NULL; the RLS check rejects it before NOT NULL would.
    const code = await pgError(as(null, (sql) => sql`insert into notes_notes (title) values ('orphan')`))
    expect(code).toBe("42501")
  })

  it("never leaks the viewer to the next transaction on the same connection", async () => {
    await as(alice, (sql) => sql`select 1`)
    const [row] = await as(null, (sql) => sql`select app.current_user_id() as viewer`)
    expect(row!.viewer).toBeNull()
  })

  it("keeps updated_at current through the trigger", async () => {
    const [before] = await as(alice, (sql) => sql`select updated_at from notes_notes`)
    await new Promise((r) => setTimeout(r, 20))
    const [after] = await as(alice, (sql) => sql`update notes_notes set body = 'edited' returning updated_at`)
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime())
  })
})
