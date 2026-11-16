"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { GoogleLogo } from "@/components/auth/google-button"
import { Fingerprint, Lock, PasswordIcon, Pencil, ShieldCheck, Trash2 } from "@/components/icons"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  confirmIdentity,
  disconnectGoogle,
  removePasskey,
  renamePasskey,
  type MethodResult,
} from "@/core/auth-actions"
import type { PasskeyItem, SignInMethods as Methods } from "@/core/sign-in-methods"
import { authClient } from "@/lib/auth-client"
import { MfaSettings } from "./mfa-settings"

const LINK_ERRORS: Record<string, string> = {
  account_already_linked_to_different_user: "That Google account is already connected to another user.",
}

const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" })

export function SignInMethods({ methods }: { methods: Methods }) {
  const router = useRouter()
  const [reauthNeeded, setReauthNeeded] = useState(!methods.fresh)
  useLinkResultToast()

  /** Shared handling for a server action's result. */
  function settle(result: MethodResult, success: string) {
    if (result.ok) {
      toast.success(success)
      router.refresh()
      return true
    }
    if (result.reauth) setReauthNeeded(true)
    toast.error(result.error)
    return false
  }

  return (
    <div className="grid">
      {reauthNeeded && <ReauthNotice />}
      <Row
        icon={<PasswordIcon />}
        title="Password"
        meta={methods.email}
        action={methods.hasPassword ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Not set</Badge>}
      />
      {methods.google.available && <GoogleRow methods={methods} locked={reauthNeeded} settle={settle} onStale={() => setReauthNeeded(true)} />}
      <PasskeysRow passkeys={methods.passkeys} locked={reauthNeeded} settle={settle} onStale={() => setReauthNeeded(true)} />
      <Row
        icon={<ShieldCheck />}
        title="Two-factor sign-in"
        meta="A 6-digit code from an authenticator app after your password or Google. Passkeys don't need it."
      >
        <MfaSettings enabled={methods.twoFactorEnabled} />
      </Row>
    </div>
  )
}

/** After the round trip to Google, Better Auth lands back here with ?connected or ?error. */
function useLinkResultToast() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const connected = params.get("connected")
  const error = params.get("error")
  useEffect(() => {
    if (!connected && !error) return
    if (connected === "google") toast.success("Google is connected. You can now sign in with it.")
    else if (error) {
      toast.error(
        LINK_ERRORS[error] ??
          "Couldn't connect Google. Use a Google account with a verified email, and try again within an hour of signing in.",
      )
    }
    router.replace(pathname, { scroll: false })
  }, [connected, error, pathname, router])
}

function ReauthNotice() {
  const [pending, startTransition] = useTransition()
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 p-3">
      <Lock className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-meta text-muted-foreground">
        To add a passkey or change Google, confirm it&apos;s you first.
      </p>
      <Button size="lg" className="h-11 sm:h-9" onClick={() => startTransition(() => confirmIdentity())} disabled={pending}>
        Confirm it&apos;s you
      </Button>
    </div>
  )
}

function Row({
  icon,
  title,
  meta,
  action,
  children,
}: {
  icon: ReactNode
  title: string
  meta?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 border-b border-border/60 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground [&_svg]:size-[18px]">
          {icon}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-body-strong">{title}</p>
          {meta && <p className="text-meta break-words text-muted-foreground">{meta}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2 self-center">{action}</div>}
      </div>
      {children && <div className="sm:pl-12">{children}</div>}
    </div>
  )
}

type RowProps = {
  locked: boolean
  settle: (result: MethodResult, success: string) => boolean
  onStale: () => void
}

function GoogleRow({ methods, locked, settle, onStale }: RowProps & { methods: Methods }) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const { connected, email } = methods.google

  async function connect() {
    startTransition(async () => {
      const result = await authClient.linkSocial({
        provider: "google",
        callbackURL: "/app/settings?connected=google",
        errorCallbackURL: "/app/settings",
      })
      // On success the browser is already on its way to Google.
      if (result?.error) {
        if (result.error.code === "SESSION_NOT_FRESH") onStale()
        toast.error(
          result.error.code === "SESSION_NOT_FRESH"
            ? "For your security, sign in again before changing how you sign in."
            : "Couldn't start connecting Google. Try again.",
        )
      }
    })
  }

  function disconnect() {
    startTransition(async () => {
      if (settle(await disconnectGoogle(), "Google is disconnected.")) setOpen(false)
    })
  }

  return (
    <Row
      icon={<GoogleLogo className="size-[18px]" />}
      title="Google"
      meta={connected ? (email ? `Connected as ${email}` : "Connected") : "Sign in with your Google account."}
      action={
        connected ? (
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger render={<Button variant="ghost" className="h-11 sm:h-8" disabled={locked} />}>
              Disconnect
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
                <AlertDialogDescription>
                  {email ?? "This Google account"} will no longer sign you in. You can connect it again later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <Button variant="destructive" onClick={disconnect} disabled={pending}>
                  Disconnect
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button variant="outline" className="h-11 sm:h-8" onClick={connect} disabled={locked || pending}>
            {pending ? "Opening Google…" : "Connect"}
          </Button>
        )
      }
    />
  )
}

function PasskeysRow({ passkeys, locked, settle, onStale }: RowProps & { passkeys: PasskeyItem[] }) {
  const router = useRouter()
  const [adding, startAdding] = useTransition()

  function add() {
    startAdding(async () => {
      const result = await authClient.passkey.addPasskey()
      if (result?.data) {
        toast.success("Passkey added. Next time, sign in with it.")
        router.refresh()
        return
      }
      const code = (result?.error as { code?: string } | null | undefined)?.code
      // Dismissed or timed out (NotAllowedError passes through).
      if (code === "ERROR_CEREMONY_ABORTED" || code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY") return
      if (code === "SESSION_NOT_FRESH") {
        onStale()
        toast.error("For your security, sign in again before adding a passkey.")
        return
      }
      toast.error(
        code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
          ? "This device already has a passkey for anwar.os."
          : "Couldn't add the passkey. Try again.",
      )
    })
  }

  return (
    <Row
      icon={<Fingerprint />}
      title="Passkeys"
      meta={
        passkeys.length
          ? "Face ID, Touch ID, Windows Hello or a security key. No code needed after a passkey."
          : "Sign in with Face ID, Touch ID, Windows Hello or a security key. Fastest, and can't be phished."
      }
      action={
        <Button variant={passkeys.length ? "outline" : "default"} className="h-11 sm:h-8" onClick={add} disabled={locked || adding}>
          {adding ? "Waiting…" : "Add passkey"}
        </Button>
      }
    >
      {passkeys.length > 0 && (
        <ul className="grid gap-1" aria-label="Your passkeys">
          {passkeys.map((p) => (
            <PasskeyRow key={p.id} passkey={p} settle={settle} />
          ))}
        </ul>
      )}
    </Row>
  )
}

function PasskeyRow({ passkey, settle }: { passkey: PasskeyItem; settle: RowProps["settle"] }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(passkey.name)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function save() {
    if (name.trim() === passkey.name) return setEditing(false)
    startTransition(async () => {
      if (settle(await renamePasskey(passkey.id, name), "Passkey renamed.")) setEditing(false)
    })
  }

  function remove() {
    startTransition(async () => {
      if (settle(await removePasskey(passkey.id), "Passkey removed.")) setOpen(false)
    })
  }

  return (
    <li className="flex items-center gap-2 rounded-lg bg-muted/40 py-1.5 pr-1.5 pl-3">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Input
            aria-label="Passkey name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setName(passkey.name)
                setEditing(false)
              }
            }}
            autoFocus
            className="h-9"
          />
          <Button type="submit" size="sm" className="h-9" disabled={pending}>
            Save
          </Button>
        </form>
      ) : (
        <div className="grid min-w-0 flex-1">
          <p className="truncate text-body">{passkey.name}</p>
          <p className="text-caption text-muted-foreground tabular-nums">
            Added {dateFormat.format(new Date(passkey.createdAt))} · {passkey.synced ? "Synced" : "This device only"}
          </p>
        </div>
      )}
      {!editing && (
        <Button variant="ghost" size="icon" className="size-11 sm:size-8" aria-label={`Rename ${passkey.name}`} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={<Button variant="ghost" size="icon" className="size-11 sm:size-8" aria-label={`Remove ${passkey.name}`} />}
        >
          <Trash2 />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{passkey.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It will stop signing you in. Also delete it from your device or password manager, so it doesn&apos;t keep
              being offered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              Remove passkey
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
