import type { ReactNode } from "react"

/**
 * The block every page opens with (Planuj Glass): accent eyebrow, display
 * title, optional description, a tabular counter and actions on the right.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  meta,
  actions,
}: {
  title: string
  eyebrow?: string
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="grid min-w-0 gap-1.5">
        {eyebrow && <p className="text-eyebrow text-text-accent">{eyebrow}</p>}
        <div className="flex items-baseline gap-3">
          <h1 className="text-greeting">{title}</h1>
          {meta && <p className="text-meta text-muted-foreground tabular-nums">{meta}</p>}
        </div>
        {description && <p className="text-meta max-w-prose text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  )
}
