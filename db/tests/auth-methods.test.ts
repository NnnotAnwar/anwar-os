// Grants for sign-in methods (db/modules/auth-passkey.sql): what os_app may do
// to passkeys and linked accounts, and what it may never do.
import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} })
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const run = randomBytes(4).toString("hex")
const alice = `test-alice-${run}`
const bob = `test-bob-${run}`
const passkeyId = `pk-${run}`

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

describe("auth.passkey as os_app", () => {
  it("can register a passkey", async () => {
    await app`
      insert into auth.passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, transports)
      values (${passkeyId}, 'Mac', 'pk', ${alice}, ${`cred-${run}`}, 0, 'multiDevice', true, 'internal')`
    const [row] = await app`select user_id from auth.passkey where id = ${passkeyId}`
    expect(row?.user_id).toBe(alice)
  })

  it("can rename it and bump the signature counter", async () => {
    await app`update auth.passkey set name = 'Work Mac', counter = 3 where id = ${passkeyId}`
    const [row] = await app`select name, counter from auth.passkey where id = ${passkeyId}`
    expect(row).toEqual({ name: "Work Mac", counter: 3 })
  })

  it("cannot swap the public key, credential or owner of a passkey", async () => {
    expect(await pgError(app`update auth.passkey set public_key = 'attacker' where id = ${passkeyId}`)).toBe("42501")
    expect(await pgError(app`update auth.passkey set credential_id = 'other' where id = ${passkeyId}`)).toBe("42501")
    expect(await pgError(app`update auth.passkey set user_id = ${bob} where id = ${passkeyId}`)).toBe("42501")
  })

  it("cannot register the same credential twice", async () => {
    const code = await pgError(app`
      insert into auth.passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
      values (${`dup-${run}`}, 'pk', ${bob}, ${`cred-${run}`}, 0, 'singleDevice', false)`)
    expect(code).toBe("23505")
  })

  it("cannot change the table itself", async () => {
    expect(await pgError(app`alter table auth.passkey add column sneaky text`)).toBe("42501")
    expect(await pgError(app`truncate auth.passkey`)).toBe("42501")
  })

  it("can delete a passkey", async () => {
    await app`delete from auth.passkey where id = ${passkeyId}`
    expect(await app`select id from auth.passkey where id = ${passkeyId}`).toHaveLength(0)
  })

  it("loses a user's passkeys with the user", async () => {
    const temp = `test-temp-${run}`
    await admin`insert into auth."user" (id, name, email) values (${temp}, 'Temp', ${`${temp}@test.local`})`
    await admin`
      insert into auth.passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
      values (${`cascade-${run}`}, 'pk', ${temp}, ${`cred-temp-${run}`}, 0, 'singleDevice', false)`
    await admin`delete from auth."user" where id = ${temp}`
    expect(await admin`select id from auth.passkey where id = ${`cascade-${run}`}`).toHaveLength(0)
  })
})

describe("linked accounts and users as os_app", () => {
  it("can link and unlink a Google account (auth.account)", async () => {
    const id = `acc-google-${run}`
    await app`
      insert into auth.account (id, account_id, provider_id, user_id)
      values (${id}, ${`sub-${run}`}, 'google', ${alice})`
    await app`delete from auth.account where id = ${id}`
    expect(await app`select id from auth.account where id = ${id}`).toHaveLength(0)
  })

  it("still cannot create users, whatever the sign-in method", async () => {
    const code = await pgError(app`insert into auth."user" (id, name, email) values ('g', 'g', 'g@gmail.com')`)
    expect(code).toBe("42501")
  })

  it("still cannot delete users or change roles", async () => {
    expect(await pgError(app`delete from auth."user" where id = ${alice}`)).toBe("42501")
    expect(await pgError(app`update auth."user" set role = 'owner' where id = ${alice}`)).toBe("42501")
  })
})
