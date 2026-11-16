"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import QRCode from "qrcode"
import { z } from "zod"
import { auth } from "@/lib/auth"

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

  let needsSecondFactor = false
  try {
    const result = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    })
    // With 2FA on, Better Auth issues a short-lived 2FA cookie instead of a session.
    needsSecondFactor = "twoFactorRedirect" in result && Boolean(result.twoFactorRedirect)
  } catch {
    return { error: "Invalid email or password." }
  }

  const next = safeNext(parsed.data.next)
  if (needsSecondFactor) redirect(`/login/mfa?next=${encodeURIComponent(next)}`)
  redirect(next)
}

const mfaInput = z.object({
  code: z.string().trim().min(6, "Enter the 6-digit code or a backup code."),
  next: z.string().optional(),
})

export async function verifyMfa(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = mfaInput.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const { code } = parsed.data
  try {
    // Six digits is a TOTP code; anything else is treated as a backup code.
    if (/^\d{6}$/.test(code)) {
      await auth.api.verifyTOTP({ body: { code }, headers: await headers() })
    } else {
      await auth.api.verifyBackupCode({ body: { code }, headers: await headers() })
    }
  } catch {
    return { error: "That code didn't work. Wait for the next one or use a backup code." }
  }
  redirect(safeNext(parsed.data.next))
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() })
  redirect("/login")
}

// ---------------------------------------------------------------------------
// Two-factor setup (settings page)
// ---------------------------------------------------------------------------

export type EnrollResult =
  | { ok: true; qrSvg: string; secret: string; backupCodes: string[] }
  | { ok: false; error: string }

const password = z.string().min(1, "Enter your password.")

export async function startTwoFactorSetup(rawPassword: string): Promise<EnrollResult> {
  const parsed = password.safeParse(rawPassword)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message }
  try {
    const result = await auth.api.enableTwoFactor({
      body: { password: parsed.data, method: "totp" },
      headers: await headers(),
    })
    if (result.method !== "totp") return { ok: false, error: "Authenticator setup isn't available." }
    const { totpURI, backupCodes } = result
    const secret = new URL(totpURI).searchParams.get("secret") ?? ""
    const qrSvg = await QRCode.toString(totpURI, { type: "svg", margin: 1 })
    return { ok: true, qrSvg, secret, backupCodes }
  } catch {
    return { ok: false, error: "Wrong password." }
  }
}

export async function confirmTwoFactorSetup(code: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code." }
  try {
    await auth.api.verifyTOTP({ body: { code }, headers: await headers() })
    return { ok: true }
  } catch {
    return { ok: false, error: "That code didn't work. Try the next one." }
  }
}

export async function turnOffTwoFactor(rawPassword: string): Promise<{ ok: boolean; error?: string }> {
  const parsed = password.safeParse(rawPassword)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message }
  try {
    await auth.api.disableTwoFactor({ body: { password: parsed.data }, headers: await headers() })
    return { ok: true }
  } catch {
    return { ok: false, error: "Wrong password." }
  }
}
