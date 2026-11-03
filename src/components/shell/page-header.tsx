import type { ReactNode } from "react"

/** Module page title in the display face, with an optional mono counter and actions. */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      {meta && <p className="pb-1 font-mono text-xs text-muted-foreground tabular">{meta}</p>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  )
}
