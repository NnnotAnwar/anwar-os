"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

type Status =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "enrolling"; factorId: string; qr: string; secret: string }
  | { kind: "on"; factorId: string }

async function fetchStatus(): Promise<Status> {
  const { data } = await createClient().auth.mfa.listFactors()
  const verified = data?.totp.find((f) => f.status === "verified")
  return verified ? { kind: "on", factorId: verified.id } : { kind: "off" }
}

export function MfaSettings() {
  const [status, setStatus] = useState<Status>({ kind: "loading" })
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => fetchStatus().then(setStatus), [])

  useEffect(() => {
    let active = true
    fetchStatus().then((next) => {
      if (active) setStatus(next)
    })
    return () => {
      active = false
    }
  }, [])

  async function startEnroll() {
    setBusy(true)
    const supabase = createClient()
    // Clear abandoned enrollments so a new one can start cleanly.
    const { data: existing } = await supabase.auth.mfa.listFactors()
    for (const f of existing?.all ?? []) {
      if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    setStatus({ kind: "enrolling", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  async function confirmEnroll(factorId: string) {
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (error) return toast.error("That code didn't work. Try the next one.")
    setCode("")
    toast.success("Two-factor authentication is on.")
    setStatus({ kind: "on", factorId })
  }

  async function disable(factorId: string) {
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Two-factor authentication is off.")
    setStatus({ kind: "off" })
  }

  switch (status.kind) {
    case "loading":
      return <p className="text-sm text-muted-foreground">Checking…</p>
    case "off":
      return (
        <Button onClick={startEnroll} disabled={busy}>
          Set up authenticator
        </Button>
      )
    case "on":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            <span className="font-medium text-foreground">On.</span>{" "}
            <span className="text-muted-foreground">A code is required at every sign-in.</span>
          </p>
          <Button variant="destructive" onClick={() => disable(status.factorId)} disabled={busy}>
            Turn off
          </Button>
        </div>
      )
    case "enrolling":
      return (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void confirmEnroll(status.factorId)
          }}
        >
          <p className="text-sm text-muted-foreground">
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          {/* Supabase returns the QR as an SVG data URL; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={status.qr} alt="TOTP QR code" className="size-44 rounded-lg bg-white p-2" />
          <p className="text-xs break-all text-muted-foreground">
            Can&apos;t scan? Enter this key manually: <code className="font-mono">{status.secret}</code>
          </p>
          <div className="grid max-w-48 gap-1.5">
            <Label htmlFor="enroll-code">Code</Label>
            <Input
              id="enroll-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>
              Verify and turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => void load()} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )
  }
}
