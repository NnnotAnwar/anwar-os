import "server-only"
import { requireViewer } from "@/core/auth"
import { modulesFor } from "@/core/module"
import { modules } from "@/modules/_registry"

/**
 * Runs another module's typed action by name — the way modules talk to each
 * other (inbox → tasks, notes, links…) without importing each other's
 * internals. The input is validated by the action's own zod schema, and the
 * viewer must be allowed to use that module.
 */
export async function runModuleAction<T = unknown>(moduleId: string, name: string, input: unknown): Promise<T> {
  const viewer = await requireViewer()
  const mod = modulesFor(modules, viewer.role).find((m) => m.id === moduleId)
  if (!mod?.actions) throw new Error(`Module ${moduleId} is not available`)
  const action = (await mod.actions())[name]
  if (!action) throw new Error(`Module ${moduleId} has no action ${name}`)
  return (await action.handler(action.input.parse(input))) as T
}

/** True when the viewer can use `moduleId` (e.g. to hide a "Link" button without the links module). */
export async function hasModule(moduleId: string) {
  const viewer = await requireViewer()
  return modulesFor(modules, viewer.role).some((m) => m.id === moduleId)
}
