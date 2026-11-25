"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, DeviceMobile, KeyIcon, Lock, Plus, Robot } from "@/components/icons"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createToken, revokeToken, type CreatedToken } from "@/core/api-tokens/actions"
import type { ApiTokenItem } from "@/core/api-tokens/server"
import { tokenExpiryOptions } from "@/core/api-tokens/options"
import { confirmIdentity } from "@/core/auth-actions"
import { cn } from "@/lib/utils"

const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" })
const fieldLabel = "text-eyebrow text-muted-foreground"
const selectClass =
  "text-body h-11 w-full max-md:text-base rounded-lg border border-field-border bg-field px-2.5 outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 md:h-9"

function ago(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 2) return "just now"
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  return dateFormat.format(new Date(iso))
}

export function ApiTokens({ tokens, fresh, siteUrl }: { tokens: ApiTokenItem[]; fresh: boolean; siteUrl: string }) {
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedToken | null>(null)
  const [refusedAsStale, setRefusedAsStale] = useState(false)
  const reauthNeeded = !fresh || refusedAsStale

  return (
    <div className="grid gap-4">
      {tokens.length ? (
        <ul className="grid" aria-label="API tokens">
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} />
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted-foreground">
          No tokens yet. Create one to connect Claude (MCP) or iPhone Shortcuts to your data.
        </p>
      )}

      {reauthNeeded ? (
        <ReauthNotice />
      ) : (
        <Button className="h-11 justify-self-start sm:h-9" onClick={() => setCreating(true)}>
          <Plus />
          Create token
        </Button>
      )}

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(token) => {
          setCreating(false)
          setCreated(token)
        }}
        onStale={() => {
          setCreating(false)
          setRefusedAsStale(true)
        }}
      />
      <RevealDialog token={created} siteUrl={siteUrl} onClose={() => setCreated(null)} />
    </div>
  )
}

function ReauthNotice() {
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 p-3">
      <Lock className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-meta text-muted-foreground">To create a token, confirm it&apos;s you first.</p>
      <Button size="lg" className="h-11 sm:h-9" onClick={() => startTransition(() => confirmIdentity())} disabled={pending}>
        Confirm it&apos;s you
      </Button>
    </div>
  )
}

function TokenRow({ token }: { token: ApiTokenItem }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const write = token.scopes.includes("write")

  function revoke() {
    startTransition(async () => {
      const result = await revokeToken(token.id)
      if (!result.ok) return void toast.error(result.error)
      setOpen(false)
      toast.success(`“${token.name}” is revoked. Anything using it stops working now.`)
      router.refresh()
    })
  }

  const meta = [
    `Created ${dateFormat.format(new Date(token.createdAt))}`,
    token.lastUsedAt ? `used ${ago(token.lastUsedAt)}` : "never used",
    token.expired ? "expired" : token.expiresAt ? `expires ${dateFormat.format(new Date(token.expiresAt))}` : "no expiry",
  ].join(" · ")

  return (
    <li className="flex items-start gap-3 border-b border-border/60 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground [&_svg]:size-[18px]">
        <KeyIcon />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-strong break-words">{token.name}</p>
          <Badge variant={write ? "default" : "secondary"}>{write ? "Read and write" : "Read only"}</Badge>
          {token.expired && <Badge variant="outline">Expired</Badge>}
        </div>
        <p className="text-meta text-muted-foreground">
          <span className="font-mono">{token.prefix}…</span> · {meta}
        </p>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger render={<Button variant="ghost" className="h-11 shrink-0 self-center sm:h-8" />}>
          Revoke
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{token.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Claude, Shortcuts or anything else using this token loses access right away. This can&apos;t be undone; you
              can create a new token later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={revoke} disabled={pending}>
              Revoke
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
  onStale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (token: CreatedToken) => void
  onStale: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [write, setWrite] = useState(false)
  const [expiry, setExpiry] = useState("90")
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createToken({ name, write, expiry })
      if (!result.ok) {
        if (result.reauth) onStale()
        return void toast.error(result.error)
      }
      setName("")
      setWrite(false)
      setExpiry("90")
      onCreated(result.value)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass glass-menu sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-card-title">New API token</DialogTitle>
          <DialogDescription>A token acts as you. Give each app its own, so you can revoke one without the others.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="token-name" className={fieldLabel}>
              Name
            </Label>
            <Input
              id="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Claude on my Mac"
              maxLength={60}
              autoComplete="off"
              required
            />
          </div>
          <fieldset className="grid gap-1.5">
            <legend className={cn(fieldLabel, "mb-1.5")}>Access</legend>
            <div className="segmented w-fit" role="radiogroup" aria-label="Access">
              {[
                { value: false, label: "Read only" },
                { value: true, label: "Read and write" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={write === option.value}
                  onClick={() => setWrite(option.value)}
                  className={cn(
                    "text-small flex h-8 items-center rounded-lg px-3 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    write === option.value && "segment-active text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-caption text-muted-foreground">
              {write
                ? "Can also add and change things: capture, expenses, tasks, notes. Never sign-in settings, tokens or the server."
                : "Can look things up, never change them. Enough for “My day”."}
            </p>
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="token-expiry" className={fieldLabel}>
              Expires
            </Label>
            <select id="token-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={selectClass}>
              {tokenExpiryOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id === "never" ? "Never (until revoked)" : `In ${o.label}`}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" className="h-11 sm:h-9" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create token"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error("Couldn't copy. Select the text and copy it by hand.")
  }
}

function CopyField({ label, value, what = label }: { label: string; value: string; what?: string }) {
  return (
    <div className="grid gap-1">
      <span className={fieldLabel}>{label}</span>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="text-caption min-w-0 font-mono"
        />
        <Button type="button" variant="outline" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" onClick={() => copy(value, what)} aria-label={`Copy ${what.toLowerCase()}`}>
          <Copy />
        </Button>
      </div>
    </div>
  )
}

/** Shown once, right after creation: the token, plus everything to paste it into. */
function RevealDialog({ token, siteUrl, onClose }: { token: CreatedToken | null; siteUrl: string; onClose: () => void }) {
  const [tab, setTab] = useState<"claude" | "shortcuts">("claude")
  const base = siteUrl.replace(/\/+$/, "")
  const command = token
    ? `claude mcp add --transport http anwar-os ${base}/api/mcp --header "Authorization: Bearer ${token.token}"`
    : ""

  return (
    <Dialog open={token !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass glass-menu max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-card-title">Copy your token now</DialogTitle>
          <DialogDescription>
            This is the only time it&apos;s shown. Anyone who has it can {token?.write ? "read and change" : "read"} your data until
            you revoke it.
          </DialogDescription>
        </DialogHeader>
        {token && (
          <div className="grid gap-4">
            <CopyField label={token.name} value={token.token} what="Token" />

            <div className="segmented w-fit" role="tablist" aria-label="Use it in">
              {(
                [
                  { id: "claude", label: "Claude", icon: <Robot className="size-4" /> },
                  { id: "shortcuts", label: "iPhone Shortcuts", icon: <DeviceMobile className="size-4" /> },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "text-small flex h-8 items-center gap-1.5 rounded-lg px-3 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    tab === t.id && "segment-active text-foreground",
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "claude" ? (
              <div className="grid gap-3" role="tabpanel" aria-label="Claude">
                <CopyField label="Claude Code: run in a terminal" value={command} what="Command" />
                <CopyField label="Claude Desktop and others: server URL" value={`${base}/api/mcp`} what="URL" />
                <CopyField label="Header" value={`Authorization: Bearer ${token.token}`} what="Header" />
                <p className="text-caption text-muted-foreground">
                  {token.write ? "Claude can read and add entries." : "Claude can only read; create a read-and-write token to let it add things."}{" "}
                  Step by step: docs/API.md in the repository.
                </p>
              </div>
            ) : (
              <div className="grid gap-3" role="tabpanel" aria-label="iPhone Shortcuts">
                <p className="text-meta text-muted-foreground">
                  In Shortcuts, use <span className="text-foreground">Get contents of URL</span> with one of these URLs and a header
                  named <span className="font-mono text-foreground">Authorization</span> with the value below.
                </p>
                <CopyField label="Header value" value={`Bearer ${token.token}`} what="Header value" />
                <CopyField label="My day (GET)" value={`${base}/api/v1/today`} what="URL" />
                {token.write ? (
                  <>
                    <CopyField label="Capture (POST, text)" value={`${base}/api/v1/capture`} what="URL" />
                    <CopyField label="Add expense (POST, text)" value={`${base}/api/v1/expense`} what="URL" />
                  </>
                ) : (
                  <p className="text-caption text-muted-foreground">Capture and Add expense need a read-and-write token.</p>
                )}
                <p className="text-caption text-muted-foreground">Step by step: docs/SHORTCUTS.md in the repository.</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button className="h-11 sm:h-9" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
