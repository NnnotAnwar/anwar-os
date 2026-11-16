"use client"

import { useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, ChevronRightIcon, Plus, Star, StarFill } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { changeService, restoreServices } from "@/core/services-actions"
import { cn } from "@/lib/utils"

export type ServiceOption = { label: string; href: string; icon?: ReactNode; hint?: string }

export type ServiceCardProps = {
  id: string
  name: string
  tagline?: string
  description: string
  icon: ReactNode
  href: string
  create?: ServiceOption
  options: ServiceOption[]
  badge?: { count: number; label: string } | null
  pinned: boolean
  /** Position among pinned services, for the move buttons. */
  pinnedIndex?: number
  pinnedCount?: number
  /** "tile": compact icon tile (Today, phone grids). "card": tile plus tagline. */
  variant?: "tile" | "card"
}

/**
 * A service in the Kaspi-style grid. Tapping it opens a sheet with its options:
 * open, create, sections and public pages, plus adding it to "My services".
 */
export function ServiceCard(props: ServiceCardProps) {
  const { name, tagline, icon, badge, variant = "card" } = props
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "glass group relative grid h-full w-full content-start gap-2.5 rounded-xl text-left transition-[background-color] duration-150 outline-none hover:[--glass-bg:color-mix(in_srgb,var(--glass)_60%,white)] focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:[--glass-bg:rgb(255_255_255/0.08)]",
          variant === "tile" ? "justify-items-center p-3 text-center" : "p-3.5",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground [&_svg]:size-5">
          {icon}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-body-strong truncate">{name}</span>
          {variant === "card" && tagline && (
            <span className="text-caption truncate text-muted-foreground">{tagline}</span>
          )}
        </span>
        {badge && (
          <span
            className="text-micro absolute top-2 right-2 rounded-full bg-primary px-1.5 py-1 text-primary-foreground tabular-nums"
            aria-label={`${badge.count} ${badge.label}`}
          >
            {badge.count}
          </span>
        )}
      </button>
      <ServiceSheet {...props} open={open} onOpenChange={setOpen} />
    </>
  )
}

function ServiceSheet({
  id,
  name,
  description,
  icon,
  href,
  create,
  options,
  badge,
  pinned,
  pinnedIndex = -1,
  pinnedCount = 0,
  open,
  onOpenChange,
}: ServiceCardProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pending, startTransition] = useTransition()

  function change(kind: "pin" | "unpin" | "earlier" | "later") {
    startTransition(async () => {
      const { previous } = await changeService({ id, change: kind })
      if (kind === "pin" || kind === "unpin") {
        toast.success(kind === "pin" ? `${name} added to My services` : `${name} removed from My services`, {
          action: { label: "Undo", onClick: () => void restoreServices(previous) },
        })
      }
    })
  }

  const close = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "glass glass-menu gap-0 p-0 sm:max-w-md",
          // Bottom sheet on phones, centred panel from 640px (Planuj Glass Modal).
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <div className="flex items-start gap-3 p-4 pb-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground [&_svg]:size-5">
            {icon}
          </span>
          <div className="grid min-w-0 gap-1 pr-8">
            <DialogTitle className="text-card-title">{name}</DialogTitle>
            <DialogDescription className="text-meta text-muted-foreground">{description}</DialogDescription>
            {badge && (
              <p className="text-caption font-semibold text-text-accent tabular-nums">
                {badge.count} {badge.label}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-2 px-4">
          <div className={cn("grid gap-2", create && "grid-cols-2")}>
            <Link href={href} onClick={close} className={buttonVariants({ size: "lg" })}>
              Open {name}
            </Link>
            {create && (
              <Link href={create.href} onClick={close} className={buttonVariants({ size: "lg", variant: "outline" })}>
                <Plus />
                {create.label}
              </Link>
            )}
          </div>
        </div>

        {options.length > 0 && (
          <ul className="mt-3 grid border-t border-hairline px-2 py-2">
            {options.map((o) => (
              <li key={o.href}>
                <Link
                  href={o.href}
                  onClick={close}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 outline-none hover:bg-track focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex size-4 shrink-0 text-muted-foreground [&_svg]:size-4">{o.icon}</span>
                  <span className="grid min-w-0 flex-1">
                    <span className="text-body truncate">{o.label}</span>
                    {o.hint && <span className="text-caption truncate text-muted-foreground">{o.hint}</span>}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-1 border-t border-hairline px-3 py-2.5">
          <button
            type="button"
            onClick={() => change(pinned ? "unpin" : "pin")}
            disabled={pending}
            aria-pressed={pinned}
            className={cn(
              "text-meta flex h-9 items-center gap-2 rounded-lg px-2.5 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 [&_svg]:size-4",
              pinned ? "text-text-accent" : "text-muted-foreground",
            )}
          >
            {pinned ? <StarFill /> : <Star />}
            {pinned ? "In My services" : "Add to My services"}
          </button>
          {pinned && pinnedCount > 1 && (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => change("earlier")}
                disabled={pending || pinnedIndex <= 0}
                aria-label={`Move ${name} earlier`}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 [&_svg]:size-4"
              >
                <ArrowLeft />
              </button>
              <button
                type="button"
                onClick={() => change("later")}
                disabled={pending || pinnedIndex >= pinnedCount - 1}
                aria-label={`Move ${name} later`}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 [&_svg]:size-4"
              >
                <ArrowRight />
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
