"use client"

import { CloudArrowUp, WarningCircle } from "@/components/icons"
import { describeItem, kindLabels } from "@/lib/offline/describe"
import type { OutboxKind } from "@/lib/offline/outbox"
import { cn } from "@/lib/utils"
import { capturedLabel } from "./outbox-status"
import { useOutboxItems } from "./use-outbox"

/**
 * Captures of these kinds that are still on this device, shown at the top of
 * their list until they sync (then the server's row takes their place: same id).
 */
export function PendingItems({ kinds, className }: { kinds: readonly OutboxKind[]; className?: string }) {
  const items = useOutboxItems(kinds)
  if (!items.length) return null

  return (
    <section aria-label="Waiting to sync" className={cn("grid gap-1.5", className)}>
      <h2 className="text-eyebrow flex items-center gap-1.5 px-1 text-muted-foreground [&_svg]:size-3.5">
        <CloudArrowUp />
        On this device · waiting to sync
      </h2>
      <ul className="glass grid gap-px overflow-hidden rounded-xl">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3" data-outbox-item={item.id}>
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-500/60 motion-safe:animate-pulse data-[failed]:bg-destructive data-[failed]:animate-none"
              data-failed={item.status === "failed" ? "" : undefined}
            />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="text-body break-words">{describeItem(item)}</p>
              <p className="text-caption text-muted-foreground">
                {kindLabels[item.kind]} · {capturedLabel(item.capturedAt)} ·{" "}
                {item.status === "failed" ? (
                  <span className="inline-flex items-center gap-1 text-destructive [&_svg]:size-3.5">
                    <WarningCircle />
                    Didn&apos;t sync: {item.error}
                  </span>
                ) : (
                  "Waiting to sync"
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
