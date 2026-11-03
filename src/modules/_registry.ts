import type { ModuleManifest } from "@/core/module"
import { notes } from "./notes/manifest"

// Adding a module: create src/modules/<id>/, a migration prefixed <id>_,
// a thin route file under src/app/(private)/app/<id>/, and one line here.
export const modules = [notes] as const satisfies readonly ModuleManifest[]

export type ModuleId = (typeof modules)[number]["id"]
