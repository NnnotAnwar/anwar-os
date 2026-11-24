import "server-only"
import { modulesFor, type WidgetDef } from "@/core/module"
import type { AppRole } from "@/db/schema"
import { modules } from "@/modules/_registry"

export type TodayWidget = WidgetDef & {
  /** `${module.id}:${widget.id}`: what the saved layout refers to. */
  key: string
  moduleName: string
  href: string
}

/** Every Today widget this role can see, in registry (default) order. */
export function todayWidgets(role: AppRole): TodayWidget[] {
  return modulesFor(modules, role).flatMap((m) =>
    (m.widgets ?? []).map((w) => ({ ...w, key: `${m.id}:${w.id}`, href: m.nav[0]!.href, moduleName: m.name })),
  )
}
