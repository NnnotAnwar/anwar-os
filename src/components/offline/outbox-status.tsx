"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { CloudArrowUp, CloudSlash, Refresh, Trash2, WarningCircle } from "@/components/icons"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { discardItem, restoreItem, retryItem, syncNow } from "@/lib/offline/client"
import { describeItem, kindLabels, outboxSummary } from "@/lib/offline/describe"
import type { OutboxItem } from "@/lib/offline/outbox"
import { cn } from "@/lib/utils"
import { useOnline, useOutbox, useOutboxItems } from "./use-outbox"

/** "14:02", or "23 Nov, 14:02" when not today: device time, like the rest of the phone. */
export function capturedLabel(iso: string, now = new Date()) {
  const at = new Date(iso)
  const sameDay = at.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at)
}

/**
 * Header pill while captures wait on this device: "2 waiting to sync" (or
 * "1 didn't sync"). Opens a sheet with each item, Retry / Discard and Sync now.
 */
export function OutboxStatus() {
  const items = useOutboxItems()
  const [open, setOpen] = useState(false)
  const summary = outboxSummary(items)
  const failed = items.some((i) => i.status === "failed")

  if (!summary && !open) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={summary ?? "Sync status"}
        className={cn(
          "press flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-caption font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11 [&_svg]:size-4",
          failed ? "bg-destructive/10 text-destructive" : "bg-accent-500/10 text-text-accent",
        )}
      >
        {failed ? <WarningCircle /> : <CloudArrowUp />}
        <span className="tabular-nums md:hidden">{items.length}</span>
        <span className="max-md:hidden">{summary}</span>
      </button>
      <OutboxSheet open={open} onOpenChange={setOpen} items={items} />
    </>
  )
}

function OutboxSheet({ open, onOpenChange, items }: { open: boolean; onOpenChange: (open: boolean) => void; items: OutboxItem[] }) {
  const state = useOutbox()
  const online = useOnline()
  const [pending, startTransition] = useTransition()

  const description = !online
    ? "You're offline. These are saved on this device and sync by themselves when you're back."
    : state.signedOut
      ? "Your session ended. Sign in again and they sync."
      : (state.lastError ?? "They sync by themselves in a moment. Nothing is lost if you close the app.")

  function discard(item: OutboxItem) {
    startTransition(async () => {
      await discardItem(item.id)
      toast("Discarded", { action: { label: "Undo", onClick: () => void restoreItem(item) } })
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={items.length ? "Waiting to sync" : "All synced"} description={description}>
      <div className="grid gap-3 p-4">
        {items.length === 0 ? (
          <p className="text-meta text-muted-foreground">Everything captured on this device has reached anwar.os.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Captures on this device">
            {items.map((item) => (
              <li key={item.id} className="grid gap-1 rounded-lg border border-hairline bg-field p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-eyebrow text-text-accent">{kindLabels[item.kind]}</span>
                  <span className="text-caption ml-auto text-muted-foreground tabular-nums">{capturedLabel(item.capturedAt)}</span>
                </div>
                <p className="text-body break-words">{describeItem(item)}</p>
                {item.status === "failed" && (
                  <p className="text-caption text-destructive" role="alert">
                    {item.error}
                  </p>
                )}
                <div className="flex justify-end gap-1">
                  {item.status === "failed" && (
                    <Button variant="ghost" size="lg" disabled={pending || !online} onClick={() => startTransition(() => retryItem(item.id))}>
                      <Refresh />
                      Retry
                    </Button>
                  )}
                  <Button variant="ghost" size="lg" disabled={pending} onClick={() => discard(item)} className="hover:text-destructive">
                    <Trash2 />
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          {!online && (
            <span className="text-caption flex items-center gap-1.5 text-muted-foreground [&_svg]:size-4">
              <CloudSlash />
              Offline
            </span>
          )}
          <Button
            className="ml-auto"
            size="lg"
            disabled={!online || state.syncing || pending || !items.some((i) => i.status === "pending")}
            onClick={() => startTransition(async () => void (await syncNow()))}
          >
            <Refresh />
            {state.syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
