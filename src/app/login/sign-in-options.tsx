"use client"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import { GoogleButton } from "@/components/auth/google-button"
import { Fingerprint } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { authClient, passkeySupport } from "@/lib/auth-client"
import { LoginForm } from "./login-form"

const GOOGLE_ERRORS: Record<string, string> = {
  account_not_linked:
    "This Google account isn't connected to anwar.os. Sign in another way, then connect Google in Settings.",
  signup_disabled:
    "This Google account isn't connected to anwar.os. Sign in another way, then connect Google in Settings.",
  access_denied: "Google sign-in was cancelled.",
}

function googleErrorMessage(code: string | undefined) {
  if (!code) return undefined
  return GOOGLE_ERRORS[code] ?? "Google sign-in didn't work. Try again, or sign in another way."
}

type Support = { supported: boolean; platform: boolean }

export function SignInOptions({
  next,
  googleEnabled,
  errorCode,
}: {
  next?: string
  googleEnabled: boolean
  errorCode?: string
}) {
  const target = next ?? "/app"
  // Until the browser answers, assume passkeys work but aren't the default.
  const [support, setSupport] = useState<Support>({ supported: true, platform: false })
  const [message, setMessage] = useState(() => googleErrorMessage(errorCode))
  const [busy, setBusy] = useState<"passkey" | "google" | null>(null)
  const autofillStarted = useRef(false)

  /** Ends a passkey ceremony, from the button or from the email field's autofill. */
  function finish(result: { data: unknown; error: unknown } | undefined) {
    if (result?.data) {
      window.location.assign(target)
      return
    }
    setBusy(null)
    const code = (result?.error as { code?: string } | null | undefined)?.code
    // Dismissed or timed out (NotAllowedError passes through), or replaced by
    // another ceremony (the autofill request gives way to the button).
    if (!code || ["AUTH_CANCELLED", "ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"].includes(code)) return
    setMessage(
      code === "PASSKEY_NOT_FOUND"
        ? "That passkey isn't registered here anymore. Sign in another way."
        : code === "ERROR_INVALID_DOMAIN"
          ? "Passkeys need a domain name, not an IP address. Open this site via localhost."
          : "Passkey sign-in didn't work. Try again, or sign in another way.",
    )
  }

  const finishAutofill = useEffectEvent(finish)

  useEffect(() => {
    let cancelled = false
    passkeySupport().then((s) => {
      if (cancelled) return
      setSupport(s)
      // Conditional UI: saved passkeys show up in the email field's autofill.
      if (s.autofill && !autofillStarted.current) {
        autofillStarted.current = true
        authClient.signIn.passkey({ autoFill: true }).then(finishAutofill)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function withPasskey() {
    setBusy("passkey")
    setMessage(undefined)
    finish(await authClient.signIn.passkey())
  }

  async function withGoogle() {
    setBusy("google")
    setMessage(undefined)
    const errorTarget = next ? `/login?next=${encodeURIComponent(next)}` : "/login"
    // Redirects to Google; on return Better Auth sends us to `target` (or to
    // the 2FA step, or back here with ?error=).
    const result = await authClient.signIn.social({ provider: "google", callbackURL: target, errorCallbackURL: errorTarget })
    if (result?.error) {
      setBusy(null)
      setMessage(googleErrorMessage("unknown"))
    }
  }

  const passkeyFirst = support.supported && support.platform

  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        {support.supported && (
          <Button
            type="button"
            size="lg"
            variant={passkeyFirst ? "default" : "secondary"}
            className="h-11"
            onClick={withPasskey}
            disabled={busy !== null}
          >
            <Fingerprint className="size-5" />
            {busy === "passkey" ? "Waiting for your passkey…" : "Sign in with a passkey"}
          </Button>
        )}
        {googleEnabled && (
          <GoogleButton size="lg" className="h-11" onClick={withGoogle} disabled={busy !== null}>
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </GoogleButton>
        )}
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 text-caption text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or use your email
        <span className="h-px flex-1 bg-border" />
      </div>

      <LoginForm next={next} secondary={passkeyFirst} />
    </div>
  )
}
