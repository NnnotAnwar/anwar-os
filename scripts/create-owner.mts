/**
 * Creates (or promotes) the owner account. Sign-ups are disabled, so this is the
 * only way the owner gets in. Uses the secret key, so it runs only from a trusted
 * machine, never from the app.
 *
 *   pnpm owner:create you@example.com          # prompts for a password
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (loaded from .env.local).
 */
import { createInterface } from "node:readline/promises"
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const email = process.argv[2]

if (!url || !secretKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.")
if (!email) throw new Error("Usage: pnpm owner:create <email>")

const password = process.env.OWNER_PASSWORD ?? (await prompt("Password (min 12 chars): "))
if (password.length < 12) throw new Error("Use a password of at least 12 characters.")

const admin = createClient(url, secretKey, { auth: { persistSession: false } })

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: "Anwar" },
})

let userId = created.user?.id
if (createError) {
  if (createError.code !== "email_exists") throw createError
  // Already exists: find it and just make sure it is the owner.
  const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  userId = list.users.find((u) => u.email === email)?.id
  console.log("User already exists; password left unchanged.")
}
if (!userId) throw new Error("Could not resolve the owner's user id.")

const { error: roleError } = await admin.from("profiles").update({ role: "owner" }).eq("id", userId)
if (roleError) throw roleError

console.log(`Owner ready: ${email}`)

async function prompt(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}
