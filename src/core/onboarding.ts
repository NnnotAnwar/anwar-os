import "server-only"
import { sql } from "drizzle-orm"
import { asViewer, requireViewer } from "@/core/auth"

export type SetupStep = { id: string; label: string; hint: string; href: string; done: boolean }

/** True if the query returns a row; false if the table isn't there (module not installed). */
async function exists(query: ReturnType<typeof sql>) {
  try {
    const rows = await asViewer((tx) => tx.execute(query))
    return rows.length > 0
  } catch {
    return false
  }
}

/**
 * The "Get started" checklist on Today. Each step checks real data (RLS scopes
 * every query to the viewer), so it ticks itself off as the owner works.
 */
export async function getSetup(): Promise<{ steps: SetupStep[]; dismissed: boolean }> {
  const viewer = await requireViewer()
  const [prefs, task, note, event, cv] = await Promise.all([
    asViewer((tx) =>
      tx.execute<{ dismissed_hints: string[] }>(sql`select dismissed_hints from core_preferences limit 1`),
    ).catch(() => []),
    exists(sql`select 1 from tasks_tasks limit 1`),
    exists(sql`select 1 from notes_notes where owner_id = app.current_user_id() limit 1`),
    exists(sql`select 1 from calendar_events limit 1`),
    exists(sql`select 1 from cv_profile where is_public limit 1`),
  ])
  const pref = prefs[0]
  const steps: SetupStep[] = [
    {
      id: "services",
      label: "Pick your services",
      hint: "Star what you use most — it shows up here and in the sidebar.",
      href: "/app/services",
      done: Boolean(pref),
    },
    {
      id: "two-factor",
      label: "Turn on two-factor sign-in",
      hint: "A code from your phone at every sign-in.",
      href: "/app/settings",
      done: viewer.twoFactorEnabled,
    },
    { id: "task", label: "Add your first task", hint: "Plain words work: “Call the bank tomorrow 10:00”.", href: "/app/tasks?new=1", done: task },
    { id: "note", label: "Write your first note", hint: "Anything — it saves as you type.", href: "/app/notes/new", done: note },
    { id: "event", label: "Add an event", hint: "Birthdays, exams, deadlines.", href: "/app/calendar?new=1", done: event },
    { id: "cv", label: "Publish your CV", hint: "Visitors read it at /cv.", href: "/app/cv", done: cv },
  ]
  return { steps, dismissed: Boolean(pref?.dismissed_hints?.includes("get-started")) }
}
