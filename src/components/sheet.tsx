"use client"

import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { SheetHandle } from "@/components/services/service-card"
import { cn } from "@/lib/utils"

/** Planuj Glass Modal: a bottom sheet with a grab handle on phones, a centred panel from 640px. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  hideTitle,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  hideTitle?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "glass glass-menu sheet max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-md",
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92svh] max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <SheetHandle onDismiss={() => onOpenChange(false)} />
        <div className={cn("grid gap-1 px-4 pt-4 pr-12 max-sm:pt-1", hideTitle && "sr-only")}>
          <DialogTitle className="text-card-title">{title}</DialogTitle>
          {description && <DialogDescription className="text-meta text-muted-foreground">{description}</DialogDescription>}
        </div>
        {/* No visible title: keep the band the close button (top right, 8–36px) sits in, so the content starts below it. */}
        {hideTitle && <div aria-hidden className="h-10 max-sm:h-6" />}
        {children}
      </DialogContent>
    </Dialog>
  )
}
