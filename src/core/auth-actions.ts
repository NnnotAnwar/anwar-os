"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

export type AuthFormState = { error?: string }

const credentials = z.object({
  email: z.email(),
  password: z.string().min(1),
  next: z.string().optional(),
})

/** Only allow redirects back into the private zone (no open redirects). */
function safeNext(next: string | undefined) {
  return next && /^\/app(\/[\w\-/]*)?$/.test(next) ? next : "/app"
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: "Enter a valid email and password." }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error) return { error: "Invalid email or password." }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const next = safeNext(parsed.data.next)
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/login/mfa?next=${encodeURIComponent(next)}`)
  }
  redirect(next)
}

const mfaInput = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  next: z.string().optional(),
})

export async function verifyMfa(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = mfaInput.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const supabase = await createClient()
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
  const totp = factors?.totp.find((f) => f.status === "verified")
  if (listError || !totp) return { error: "No authenticator is set up for this account." }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: totp.id,
    code: parsed.data.code,
  })
  if (error) return { error: "That code didn't work. Try the next one." }

  redirect(safeNext(parsed.data.next))
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
