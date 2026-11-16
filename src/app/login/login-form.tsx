"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, type AuthFormState } from "@/core/auth-actions"

/** Email + password. `secondary` when a passkey is the better way in on this device. */
export function LoginForm({ next, secondary = false }: { next?: string; secondary?: boolean }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signIn, {})

  return (
    <form action={action} className="grid gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        {/* "webauthn" lets the browser offer saved passkeys right in this field. */}
        <Input id="email" name="email" type="email" autoComplete="username webauthn" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" variant={secondary ? "secondary" : "default"} className="h-11" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}
