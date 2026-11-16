import type { ModuleManifest } from "@/core/module"
import { cv } from "./cv/manifest"
import { files } from "./files/manifest"
import { ideas } from "./ideas/manifest"
import { notes } from "./notes/manifest"
import { projects } from "./projects/manifest"
import { tools } from "./tools/manifest"
import { links } from "./links/manifest"
import { feedback } from "./feedback/manifest"

// Adding a module: create src/modules/<id>/, a migration prefixed <id>_,
// a thin route file under src/app/(private)/app/<id>/, and one line here.
const registered = [notes, tools, links, feedback, cv, projects, ideas, files] as const satisfies readonly ModuleManifest[]

export type ModuleId = (typeof registered)[number]["id"]

// Widened to the contract so optional fields (create, widgets, …) stay readable
// on every entry, not only on the modules that happen to define them.
export const modules: readonly (ModuleManifest & { id: ModuleId })[] = registered
