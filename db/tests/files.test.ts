// Row-level security for the files module: `pnpm test:db`.
// Same setup as rls.test.ts: `admin` creates fixtures, `app` is os_app.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-files-alice-${run}`
const bob = `test-files-bob-${run}`

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

let aliceFolder = ""
let aliceChild = ""

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

describe("files_folders", () => {
  it("lets a user create a folder tree; owner_id defaults to the viewer", async () => {
    const [root] = await as(alice, (sql) => sql`insert into files_folders (name) values ('Taxes') returning id, owner_id`)
    expect(root!.owner_id).toBe(alice)
    aliceFolder = root!.id
    const [child] = await as(
      alice,
      (sql) => sql`insert into files_folders (name, parent_id) values ('2026', ${aliceFolder}) returning id`,
    )
    aliceChild = child!.id
  })

  it("keeps sibling names unique, top level included", async () => {
    const code = await pgError(as(alice, (sql) => sql`insert into files_folders (name) values ('Taxes')`))
    expect(code).toBe("23505")
    // The same name is fine for another user.
    await as(bob, (sql) => sql`insert into files_folders (name) values ('Taxes')`)
  })

  it("hides other users' folders and refuses changes to them", async () => {
    const result = await as(bob, async (sql) => {
      const rows = await sql`select id from files_folders where id = ${aliceFolder}`
      const updated = await sql`update files_folders set name = 'mine' where id = ${aliceFolder}`
      const deleted = await sql`delete from files_folders where id = ${aliceFolder}`
      return { seen: rows.length, updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ seen: 0, updated: 0, deleted: 0 })
  })

  it("refuses nesting a folder inside someone else's folder", async () => {
    const code = await pgError(
      as(bob, (sql) => sql`insert into files_folders (name, parent_id) values ('sneaky', ${aliceFolder})`),
    )
    expect(code).toBe("23503")
  })

  it("refuses a folder that is its own parent", async () => {
    const code = await pgError(
      as(alice, (sql) => sql`update files_folders set parent_id = id where id = ${aliceFolder}`),
    )
    expect(code).toBe("23514")
  })
})

describe("files_files", () => {
  it("records a file whose key sits under the owner's prefix", async () => {
    const [file] = await as(
      alice,
      (sql) => sql`
        insert into files_files (name, size_bytes, mime, storage_key, folder_id, tags)
        values ('return.pdf', 1024, 'application/pdf', ${`${alice}/${run}-1`}, ${aliceChild}, ${["tax"]})
        returning owner_id, tags`,
    )
    expect(file).toEqual({ owner_id: alice, tags: ["tax"] })
  })

  it("refuses a storage key outside the owner's prefix", async () => {
    const code = await pgError(
      as(
        bob,
        (sql) => sql`
          insert into files_files (name, size_bytes, mime, storage_key)
          values ('steal.pdf', 1, 'application/pdf', ${`${alice}/${run}-1-copy`})`,
      ),
    )
    expect(code).toBe("23514")
  })

  it("refuses files over 100 MB", async () => {
    const code = await pgError(
      as(
        alice,
        (sql) => sql`
          insert into files_files (name, size_bytes, mime, storage_key)
          values ('huge.zip', 104857601, 'application/zip', ${`${alice}/${run}-huge`})`,
      ),
    )
    expect(code).toBe("23514")
  })

  it("refuses filing into someone else's folder", async () => {
    const code = await pgError(
      as(
        bob,
        (sql) => sql`
          insert into files_files (name, size_bytes, mime, storage_key, folder_id)
          values ('x.pdf', 1, 'application/pdf', ${`${bob}/${run}-x`}, ${aliceFolder})`,
      ),
    )
    expect(code).toBe("23503")
  })

  it("hides other users' files and refuses changes to them", async () => {
    const result = await as(bob, async (sql) => {
      const rows = await sql`select id from files_files`
      const updated = await sql`update files_files set name = 'hijacked'`
      const deleted = await sql`delete from files_files`
      return { seen: rows.length, updated: updated.count, deleted: deleted.count }
    })
    expect(result).toEqual({ seen: 0, updated: 0, deleted: 0 })
  })

  it("refuses handing a file to someone else", async () => {
    const code = await pgError(as(alice, (sql) => sql`update files_files set owner_id = ${bob}`))
    expect(code).toBe("42501")
  })

  it("keeps updated_at current through the trigger", async () => {
    const [before] = await as(alice, (sql) => sql`select updated_at from files_files`)
    await new Promise((r) => setTimeout(r, 20))
    const [after] = await as(alice, (sql) => sql`update files_files set description = 'filed' returning updated_at`)
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime())
  })
})

describe("files_documents", () => {
  it("lets a user write a document in their folder", async () => {
    const [doc] = await as(
      alice,
      (sql) => sql`insert into files_documents (title, body, folder_id) values ('Checklist', '- [ ] W-2', ${aliceFolder}) returning owner_id`,
    )
    expect(doc!.owner_id).toBe(alice)
  })

  it("hides other users' documents and refuses forged ones", async () => {
    const rows = await as(bob, (sql) => sql`select id from files_documents`)
    expect(rows).toHaveLength(0)
    const code = await pgError(
      as(bob, (sql) => sql`insert into files_documents (owner_id, title) values (${alice}, 'forged')`),
    )
    expect(code).toBe("42501")
  })

  it("shows nothing and accepts nothing without a viewer", async () => {
    const counts = await as(null, async (sql) => {
      const [f] = await sql`select count(*)::int as n from files_folders`
      const [d] = await sql`select count(*)::int as n from files_documents`
      const [x] = await sql`select count(*)::int as n from files_files`
      return [f!.n, d!.n, x!.n]
    })
    expect(counts).toEqual([0, 0, 0])
    const code = await pgError(as(null, (sql) => sql`insert into files_documents (title) values ('orphan')`))
    expect(code).toBe("42501")
  })
})

describe("deleting a folder", () => {
  it("removes its subfolders, files and documents with it", async () => {
    await as(alice, (sql) => sql`delete from files_folders where id = ${aliceFolder}`)
    const counts = await as(alice, async (sql) => {
      const [f] = await sql`select count(*)::int as n from files_folders`
      const [d] = await sql`select count(*)::int as n from files_documents`
      const [x] = await sql`select count(*)::int as n from files_files`
      return [f!.n, d!.n, x!.n]
    })
    expect(counts).toEqual([0, 0, 0])
    // Bob's own folder of the same name is untouched.
    const rows = await as(bob, (sql) => sql`select name from files_folders`)
    expect(rows).toHaveLength(1)
  })
})
