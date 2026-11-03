// Public Supabase config. Both values are safe to ship to the browser:
// the publishable key only grants what RLS allows.
export const SUPABASE_URL = required(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "NEXT_PUBLIC_SUPABASE_URL",
)
export const SUPABASE_PUBLISHABLE_KEY = required(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
)

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing env var ${name}. See .env.example.`)
  return value
}
