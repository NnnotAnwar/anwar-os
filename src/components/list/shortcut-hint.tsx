import { Fragment, type ReactNode } from "react"
import type { AppIcon } from "@/components/icons"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

/**
 * The quiet line under a list that says which keys work here. Only for
 * mouse-and-keyboard screens; touch screens get a swipe hint instead.
 */
export function ShortcutHint({ items, touch, className }: { items: [string[], string][]; touch?: string; className?: string }) {
  return (
    <>
      <p className={cn("text-caption hidden flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground pointer-fine:flex", className)}>
        {items.map(([keys, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            {keys.map((k, i) => (
              <Fragment key={k}>
                {i > 0 && <span className="sr-only"> or </span>}
                <Kbd>{k}</Kbd>
              </Fragment>
            ))}
            <span>{label}</span>
          </span>
        ))}
      </p>
      {touch && <p className={cn("text-caption text-muted-foreground pointer-fine:hidden", className)}>{touch}</p>}
    </>
  )
}

/**
 * Empty states: a duotone illustration, one sentence, one primary action.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: AppIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("glass grid justify-items-center gap-3 rounded-xl px-6 py-10 text-center", className)}>
      <span className="flex size-14 items-center justify-center rounded-xl bg-secondary text-text-accent">
        <Icon className="size-8" />
      </span>
      <div className="grid max-w-sm gap-1">
        <p className="text-card-title">{title}</p>
        {children && <p className="text-meta text-muted-foreground">{children}</p>}
      </div>
      {action}
    </div>
  )
}
