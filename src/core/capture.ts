/**
 * Capture: one screen (/app/capture) that turns something shared from another
 * app (the PWA share target) or typed in a hurry into an item of some module.
 *
 * Destinations are a list, so adding one is two lines: an entry here and a
 * saver in capture-actions.ts. The first entry is the default: the inbox, so a
 * share is one tap and gets sorted later. This file is shared by the server and
 * the form, so it holds only plain data and pure helpers.
 */

export const captureDestinations = [
  { id: "inbox", label: "Inbox", hint: "Sort it out later." },
  { id: "note", label: "Note", hint: "Text you want to keep." },
  { id: "link", label: "Link", hint: "Saved with its title and icon." },
  { id: "idea", label: "Idea", hint: "Lands on the ideas board as raw." },
] as const satisfies readonly { id: string; label: string; hint: string }[]

export type CaptureDestinationId = (typeof captureDestinations)[number]["id"]

export function isCaptureDestination(id: string): id is CaptureDestinationId {
  return captureDestinations.some((d) => d.id === id)
}

export type CaptureDraft = { title: string; text: string; url: string }

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i

function cleanUrl(raw: string | undefined): string {
  const value = raw?.trim().replace(/[).,;!?]+$/, "") ?? ""
  if (!value) return ""
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""
  } catch {
    return ""
  }
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.slice(0, 20_000) ?? ""
}

/**
 * What a share sheet sends is messy: Android often puts the URL inside `text`,
 * iOS sends `url` and repeats it in `text`, some apps put the page title in
 * `text`. Normalise to a title, a body and at most one http(s) URL.
 */
export function parseShared(params: Record<string, string | string[] | undefined>): CaptureDraft {
  let title = first(params.title).trim()
  let text = first(params.text).trim()
  let url = cleanUrl(first(params.url))

  if (!url) {
    const found = text.match(URL_IN_TEXT)?.[0]
    url = cleanUrl(found)
  }
  if (url) {
    // Drop the URL (and a bare repeat of the title) from the body.
    const bare = url.replace(/\/$/, "")
    text = text
      .split(/\s+/)
      .filter((word) => cleanUrl(word).replace(/\/$/, "") !== bare)
      .join(" ")
      .trim()
  }
  if (text && text === title) text = ""
  if (!title && text && !text.includes("\n") && text.length <= 120) {
    title = text
    text = ""
  }
  return { title: title.slice(0, 200), text, url }
}

/** The inbox keeps one text plus an optional URL: the title leads the text. */
export function inboxText(draft: CaptureDraft): string {
  return [draft.title.trim(), draft.text.trim()].filter(Boolean).join("\n")
}

/** A title for modules that need one: the given title, the first line, or the site. */
export function titleFor(draft: CaptureDraft): string {
  if (draft.title.trim()) return draft.title.trim().slice(0, 200)
  const line = draft.text.trim().split("\n")[0]?.trim()
  if (line) return line.length > 80 ? `${line.slice(0, 79)}…` : line
  if (draft.url) {
    try {
      return new URL(draft.url).hostname.replace(/^www\./, "")
    } catch {
      // fall through
    }
  }
  return "Untitled"
}

/** Body text with the URL appended, for destinations without a URL field. */
export function bodyFor(draft: CaptureDraft): string {
  let text = draft.text.trim()
  if (!draft.title.trim()) {
    // The first line became the title (see titleFor) unless it was too long.
    const [line = "", ...rest] = text.split("\n")
    if (line.trim().length <= 80) text = rest.join("\n").trim()
  }
  return [text, draft.url].filter(Boolean).join("\n\n")
}
