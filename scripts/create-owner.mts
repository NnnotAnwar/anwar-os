/**
 * Creates (or promotes) the owner account. Sign-ups are disabled and the app's
 * database role can't insert users or change roles, so this script connects with
 * the migration role. Run it only from a trusted machine, never from the app.
 *
 *   pnpm owner:create you@example.com          # prompts for a password
 *
 * Env: MIGRATION_DATABASE_URL (loaded from .env.local), optional OWNER_PASSWORD.
 */
import { randomBytes } from "node:crypto"
import { createInterface } from "node:readline/promises"
import { hashPassword } from "better-auth/crypto"
import postgres from "postgres"

const url = process.env.MIGRATION_DATABASE_URL
const email = process.argv[2]?.trim().toLowerCase()

if (!url) throw new Error("Set MIGRATION_DATABASE_URL.")
if (!email) throw new Error("Usage: pnpm owner:create <email>")

const sql = postgres(url, { max: 1 })
const newId = () => randomBytes(16).toString("hex")

try {
  const [existing] = await sql<{ id: string }[]>`select id from auth."user" where email = ${email}`

  if (existing) {
    await sql`update auth."user" set role = 'owner', updated_at = now() where id = ${existing.id}`
    console.log(`User already exists; promoted to owner, password left unchanged: ${email}`)
  } else {
    const password = process.env.OWNER_PASSWORD ?? (await prompt("Password (min 12 chars): "))
    if (password.length < 12) throw new Error("Use a password of at least 12 characters.")
    const hash = await hashPassword(password)
    const userId = newId()

    // Same rows Better Auth writes for an email + password sign-up.
    await sql.begin(async (tx) => {
      await tx`
        insert into auth."user" (id, name, email, email_verified, role)
        values (${userId}, 'Anwar', ${email}, true, 'owner')`
      await tx`
        insert into auth.account (id, account_id, provider_id, user_id, password)
        values (${newId()}, ${userId}, 'credential', ${userId}, ${hash})`
    })
    console.log(`Owner created: ${email}`)
  }
} finally {
  await sql.end()
}

async function prompt(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}
