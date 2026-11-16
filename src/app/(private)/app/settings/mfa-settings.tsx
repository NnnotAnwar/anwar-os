"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { confirmTwoFactorSetup, startTwoFactorSetup, turnOffTwoFactor } from "@/core/auth-actions"

type Step =
  | { kind: "off" }
  | { kind: "password"; intent: "enable" | "disable" }
  | { kind: "scan"; qrSvg: string; secret: string; backupCodes: string[] }
  | { kind: "on" }

export function MfaSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(enabled ? { kind: "on" } : { kind: "off" })
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function reset(next: Step) {
    setStep(next)
    setPassword("")
    setCode("")
    setError(undefined)
  }

  function submitPassword(intent: "enable" | "disable") {
    startTransition(async () => {
      if (intent === "enable") {
        const result = await startTwoFactorSetup(password)
        if (!result.ok) return setError(result.error)
        reset({ kind: "scan", qrSvg: result.qrSvg, secret: result.secret, backupCodes: result.backupCodes })
      } else {
        const result = await turnOffTwoFactor(password)
        if (!result.ok) return setError(result.error)
        reset({ kind: "off" })
        toast.success("Two-factor sign-in is off.")
        router.refresh()
      }
    })
  }

  function confirm() {
    startTransition(async () => {
      const result = await confirmTwoFactorSetup(code)
      if (!result.ok) return setError(result.error)
      reset({ kind: "on" })
      toast.success("Two-factor sign-in is on.")
      router.refresh()
    })
  }

  const errorLine = error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )

  switch (step.kind) {
    case "off":
      return (
        <Button onClick={() => reset({ kind: "password", intent: "enable" })}>Set up authenticator</Button>
      )
    case "on":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            <span className="font-medium text-foreground">On.</span>{" "}
            <span className="text-muted-foreground">A code is required at every sign-in.</span>
          </p>
          <Button variant="destructive" onClick={() => reset({ kind: "password", intent: "disable" })}>
            Turn off
          </Button>
        </div>
      )
    case "password":
      return (
        <form
          className="grid max-w-sm gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submitPassword(step.intent)
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="mfa-password">Confirm your password</Label>
            <Input
              id="mfa-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </div>
          {errorLine}
          <div className="flex gap-2">
            <Button type="submit" variant={step.intent === "disable" ? "destructive" : "default"} disabled={pending}>
              {step.intent === "enable" ? "Continue" : "Turn off two-factor"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset(enabled ? { kind: "on" } : { kind: "off" })}>
              Cancel
            </Button>
          </div>
        </form>
      )
    case "scan":
      return (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            confirm()
          }}
        >
          <p className="text-sm text-muted-foreground">
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          <div
            role="img"
            aria-label="TOTP QR code"
            className="size-44 rounded-lg bg-white p-2 [&_svg]:size-full"
            // Generated on the server by the qrcode package from the TOTP URI.
            dangerouslySetInnerHTML={{ __html: step.qrSvg }}
          />
          <p className="text-xs break-all text-muted-foreground">
            Can&apos;t scan? Enter this key manually: <code className="font-mono">{step.secret}</code>
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Backup codes</summary>
            <p className="mt-2 text-muted-foreground">
              Each works once if you lose your phone. Store them in your password manager now; they won&apos;t
              be shown again.
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-5">
              {step.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
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
          {errorLine}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || code.length !== 6}>
              Verify and turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset({ kind: "off" })} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )
  }
}
