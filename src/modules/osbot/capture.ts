import "server-only"
import { z } from "zod"
import { hasModule, runModuleAction } from "@/core/module-actions"
import { InboxInputError } from "@/modules/inbox/actions"
import { TaskInputError } from "@/modules/tasks/actions"

// Where osbot can save things. The bot asks GET capture/targets and builds its
// "Save to Inbox / Save as …" buttons from this list, so adding a destination is
// one entry here and no bot change. Every save goes through the owning
// module's own action (runModuleAction), as the owner (actAs in api.ts).
//
// Inbox is the default: /save and the first button. /note, /link, /idea and
// /task in the bot are direct shortcuts to the other targets.
// OSBOT_DEFAULT_CAPTURE=<kind> overrides the default without a code change.

export type CaptureResult = { kind: string; id: string; title: string; url: string; duplicate: boolean }

export type CaptureTarget = {
  kind: string
  /** Module that owns the destination; hidden when the owner can't use it. */
  module: string
  label: string
  /** Inline button text in Telegram. Default: "Save as <label, lowercase>". */
  button?: string
  /** Only offered for messages that contain a URL. */
  needsUrl?: boolean
  isDefault?: boolean
  save: (input: { text: string; url?: string }) => Promise<CaptureResult>
}

/** A problem with the input; its message is shown to the owner in Telegram. */
export class CaptureError extends Error {}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

/** First line as the title (cut to `max`); the full text stays in the body when it didn't fit. */
export function splitTitle(text: string, max = 200): { title: string; body: string } {
  const trimmed = text.trim()
  const newline = trimmed.indexOf("\n")
  const first = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim()
  const rest = newline === -1 ? "" : trimmed.slice(newline + 1).trim()
  if (first.length <= max) return { title: first, body: rest }
  return { title: `${first.slice(0, max - 1).trimEnd()}…`, body: trimmed }
}

function requireText(text: string) {
  if (!text.trim()) throw new CaptureError("Nothing to save: send some text.")
  return text
}

/** Module actions report bad input as zod errors or *InputError; both are safe to show. */
async function run<T>(moduleId: string, name: string, input: unknown): Promise<T> {
  try {
    return await runModuleAction<T>(moduleId, name, input)
  } catch (error) {
    if (error instanceof z.ZodError) throw new CaptureError(error.issues[0]?.message ?? "That couldn't be saved.")
    if (error instanceof InboxInputError || error instanceof TaskInputError) throw new CaptureError(error.message)
    throw error
  }
}

export const captureTargets: CaptureTarget[] = [
  {
    kind: "inbox",
    module: "inbox",
    label: "Inbox",
    button: "Save to Inbox",
    isDefault: true,
    save: async ({ text, url }) => {
      const item = await run<{ id: string; text: string; url: string | null }>("inbox", "capture", {
        text,
        url: url ?? null,
        source: "telegram",
      })
      const title = splitTitle(item.text || item.url || "", 120).title
      return { kind: "inbox", id: item.id, title, url: `${baseUrl()}/app/inbox`, duplicate: false }
    },
  },
  {
    kind: "task",
    module: "tasks",
    label: "Task",
    save: async ({ text }) => {
      const { title, body } = splitTitle(requireText(text), 300)
      // The tasks parser reads "tomorrow 10:00 !high #University" from the title.
      const task = await run<{ id: string; title: string }>("tasks", "quickAdd", { text: title })
      if (body) await run("tasks", "update", { id: task.id, notes: body })
      return { kind: "task", id: task.id, title: task.title, url: `${baseUrl()}/app/tasks?task=${task.id}`, duplicate: false }
    },
  },
  {
    kind: "note",
    module: "notes",
    label: "Note",
    save: async ({ text }) => {
      const fields = splitTitle(requireText(text))
      const { id } = await run<{ id: string }>("notes", "create", fields)
      return { kind: "note", id, title: fields.title, url: `${baseUrl()}/app/notes/${id}`, duplicate: false }
    },
  },
  {
    kind: "link",
    module: "links",
    label: "Link",
    needsUrl: true,
    save: async ({ text, url: given }) => {
      const url = given || URL_IN_TEXT.exec(text)?.[0]
      if (!url) throw new CaptureError("No link found. Send a full web address, e.g. https://react.dev/learn")
      const note = text.replace(url, "").trim()
      const link = await run<{ id: string; title: string; duplicate: boolean }>("links", "create", { url, note })
      return { kind: "link", id: link.id, title: link.title, url: `${baseUrl()}/app/links/${link.id}`, duplicate: link.duplicate }
    },
  },
  {
    kind: "idea",
    module: "ideas",
    label: "Idea",
    save: async ({ text }) => {
      const fields = splitTitle(requireText(text))
      const { id } = await run<{ id: string }>("ideas", "create", fields)
      return { kind: "idea", id, title: fields.title, url: `${baseUrl()}/app/ideas/${id}`, duplicate: false }
    },
  },
]

/** Targets whose module the owner can use (all of them, for the owner). */
async function available(targets: CaptureTarget[]) {
  const usable = await Promise.all(targets.map((t) => hasModule(t.module)))
  return targets.filter((_, i) => usable[i])
}

/** The default: OSBOT_DEFAULT_CAPTURE if it names a target, else the one marked isDefault. */
export function defaultCaptureKind(targets: CaptureTarget[], env: Record<string, string | undefined> = process.env) {
  const wanted = env.OSBOT_DEFAULT_CAPTURE?.trim()
  if (wanted && targets.some((t) => t.kind === wanted)) return wanted
  return (targets.find((t) => t.isDefault) ?? targets[0])?.kind ?? null
}

/** Targets for the bot, default first. */
export async function listCaptureTargets(all = captureTargets) {
  const targets = await available(all)
  const fallback = defaultCaptureKind(targets)
  return {
    default: fallback,
    targets: [...targets]
      .sort((a, b) => Number(b.kind === fallback) - Number(a.kind === fallback))
      .map((t) => ({
        kind: t.kind,
        label: t.label,
        button: t.button ?? `Save as ${t.label.toLowerCase()}`,
        needsUrl: Boolean(t.needsUrl),
      })),
  }
}

export const captureInput = z.object({
  /** Omitted = the default target. */
  kind: z.string().trim().max(32).optional(),
  text: z.string().max(20_000).default(""),
  url: z.string().trim().max(2100).optional(),
})

export async function capture(input: z.infer<typeof captureInput>, all = captureTargets): Promise<CaptureResult> {
  const targets = await available(all)
  const kind = input.kind || defaultCaptureKind(targets)
  const target = targets.find((t) => t.kind === kind)
  if (!target) throw new CaptureError(`Unknown destination "${kind ?? ""}".`)
  return target.save({ text: input.text.trim(), url: input.url || undefined })
}

export const captureUndoInput = z.object({ kind: z.string().trim().min(1).max(32), id: z.uuid() })

/**
 * The bot's Undo right after a save: deletes what `capture` just created,
 * through the owning module's own `delete` action (every target's module has
 * one taking `{ id }`). The bot only offers it for a short while after the save
 * and never for a link that was already saved before (duplicate).
 */
export async function undoCapture(input: z.infer<typeof captureUndoInput>, all = captureTargets): Promise<{ undone: true }> {
  const target = (await available(all)).find((t) => t.kind === input.kind)
  if (!target) throw new CaptureError(`Unknown destination "${input.kind}".`)
  await run(target.module, "delete", { id: input.id })
  return { undone: true }
}
