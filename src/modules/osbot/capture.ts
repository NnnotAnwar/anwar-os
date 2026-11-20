import "server-only"
import { z } from "zod"
import { actions as ideas } from "@/modules/ideas/actions"
import { actions as links } from "@/modules/links/actions"
import { actions as notes } from "@/modules/notes/actions"

// Where osbot can save things. The bot asks GET capture/targets and builds its
// "Save as …" buttons from this list, so adding a destination is one entry
// here and no bot change. The target marked `isDefault` receives /save and is
// the first button.
//
// Planned: the inbox module's captureToInbox({ text, url? }). Once it is on
// main, add
//   { kind: "inbox", label: "Inbox", button: "Save to Inbox", isDefault: true,
//     save: ({ text, url }) => … captureToInbox({ text, url }) … }
// and drop `isDefault` from "note". (OSBOT_DEFAULT_CAPTURE overrides the
// default without a code change.)

export type CaptureResult = { kind: string; id: string; title: string; url: string; duplicate: boolean }

export type CaptureTarget = {
  kind: string
  label: string
  /** Inline button text in Telegram. Default: "Save as <label, lowercase>". */
  button?: string
  /** Only offered for messages that contain a URL. */
  needsUrl?: boolean
  isDefault?: boolean
  /** Runs inside actAs(owner): module actions act as the site owner. */
  save: (input: { text: string; url?: string }) => Promise<CaptureResult>
}

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

export const captureTargets: CaptureTarget[] = [
  {
    kind: "note",
    label: "Note",
    isDefault: true,
    save: async ({ text }) => {
      const fields = notes.create.input.parse(splitTitle(requireText(text)))
      const { id } = await notes.create.handler(fields)
      return { kind: "note", id, title: fields.title, url: `${baseUrl()}/app/notes/${id}`, duplicate: false }
    },
  },
  {
    kind: "link",
    label: "Link",
    needsUrl: true,
    save: async ({ text, url: given }) => {
      const url = given || URL_IN_TEXT.exec(text)?.[0]
      if (!url) throw new CaptureError("No link found. Send a full web address, e.g. https://react.dev/learn")
      const note = text.replace(url, "").trim()
      const parsed = links.create.input.safeParse({ url, note })
      if (!parsed.success) throw new CaptureError(parsed.error.issues[0]?.message ?? "That doesn't look like a link.")
      const result = await links.create.handler(parsed.data)
      return { kind: "link", id: result.id, title: result.title, url: `${baseUrl()}/app/links`, duplicate: result.duplicate }
    },
  },
  {
    kind: "idea",
    label: "Idea",
    save: async ({ text }) => {
      const fields = ideas.create.input.parse(splitTitle(requireText(text)))
      const { id } = await ideas.create.handler(fields)
      return { kind: "idea", id, title: fields.title, url: `${baseUrl()}/app/ideas/${id}`, duplicate: false }
    },
  },
]

/** The default destination: OSBOT_DEFAULT_CAPTURE if it names a target, else the one marked isDefault. */
export function defaultCaptureKind(targets = captureTargets, env: Record<string, string | undefined> = process.env) {
  const wanted = env.OSBOT_DEFAULT_CAPTURE?.trim()
  if (wanted && targets.some((t) => t.kind === wanted)) return wanted
  return (targets.find((t) => t.isDefault) ?? targets[0]!).kind
}

/** Targets for the bot, default first. */
export function listCaptureTargets(targets = captureTargets) {
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

export async function capture(input: z.infer<typeof captureInput>, targets = captureTargets): Promise<CaptureResult> {
  const kind = input.kind || defaultCaptureKind(targets)
  const target = targets.find((t) => t.kind === kind)
  if (!target) throw new CaptureError(`Unknown destination "${kind}".`)
  return target.save({ text: input.text.trim(), url: input.url || undefined })
}
