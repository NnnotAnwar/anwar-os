import type { ModuleManifest } from "@/core/module"
import { calendar } from "./calendar/manifest"
import { cv } from "./cv/manifest"
import { files } from "./files/manifest"
import { ideas } from "./ideas/manifest"
import { notes } from "./notes/manifest"
import { projects } from "./projects/manifest"
import { tools } from "./tools/manifest"
import { links } from "./links/manifest"
import { feedback } from "./feedback/manifest"
import { tasks } from "./tasks/manifest"
import { inbox } from "./inbox/manifest"
import { budget } from "./budget/manifest"
import { ops } from "./ops/manifest"
import { bots } from "./bots/manifest"
import { analytics } from "./analytics/manifest"
import { assistant } from "./assistant/manifest"
import { review } from "./review/manifest"
import { habits } from "./habits/manifest"
import { goals } from "./goals/manifest"
import { journal } from "./journal/manifest"
import { documents } from "./documents/manifest"
import { now } from "./now/manifest"

// Adding a module: create src/modules/<id>/, a migration prefixed <id>_,
// a thin route file under src/app/(private)/app/<id>/, and one line here.
// Order is priority: the default "My services" and the order of the Services grid.
const registered = [tasks, inbox, notes, calendar, budget, habits, journal, files, documents, links, ideas, projects, goals, now, cv, feedback, analytics, ops, bots, tools, assistant, review] as const satisfies readonly ModuleManifest[]

export type ModuleId = (typeof registered)[number]["id"]

// Widened to the contract so optional fields (create, widgets, …) stay readable
// on every entry, not only on the modules that happen to define them.
export const modules: readonly (ModuleManifest & { id: ModuleId })[] = registered
