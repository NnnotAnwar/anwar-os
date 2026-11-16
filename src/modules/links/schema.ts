import { z } from "zod"

/**
 * Turns what people paste into a canonical http(s) URL: trims, adds https://
 * when the scheme is missing, drops the fragment-less trailing noise the URL
 * parser normalizes anyway. Returns null when it can't be a web address.
 */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text || /\s/.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost" && !url.hostname.startsWith("["))) {
      return null
    }
    if (url.username || url.password) return null
    return url.href.length <= 2048 ? url.href : null
  } catch {
    return null
  }
}

/** Lower-case, no leading #, words joined by dashes. Empty tags disappear. */
export function normalizeTag(raw: string) {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32)
}

/** "React, #tools  ui" → ["react", "tools", "ui"], unique, at most 20. */
export function parseTags(raw: string | string[]) {
  const parts = Array.isArray(raw) ? raw : raw.split(/[,\s]+/)
  return [...new Set(parts.map(normalizeTag).filter(Boolean))].slice(0, 20)
}

/** example.com for https://www.example.com/a/b */
export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** A readable stand-in title when the page gave none: host plus first path part. */
export function fallbackTitle(url: string) {
  try {
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "")
    return `${u.hostname.replace(/^www\./, "")}${path}`.slice(0, 300)
  } catch {
    return url.slice(0, 300)
  }
}

const urlField = z
  .string()
  .max(2100, "That URL is too long. Use a shorter link.")
  .transform((value, ctx) => {
    const url = normalizeUrl(value)
    if (!url) {
      ctx.addIssue({ code: "custom", message: "Paste a full web address, e.g. https://react.dev/learn" })
      return z.NEVER
    }
    return url
  })

const tagsField = z.union([z.string().max(1000), z.array(z.string().max(100)).max(50)]).transform(parseTags)

export const linkFields = {
  url: urlField,
  title: z.string().trim().min(1, "Give the link a title.").max(300, "Keep the title under 300 characters."),
  description: z.string().trim().max(1000, "Keep the description under 1000 characters."),
  tags: tagsField,
  note: z.string().max(5000, "Keep the note under 5000 characters."),
  isPublic: z.boolean(),
  readLater: z.boolean(),
}

export const createLinkInput = z.object({
  url: urlField,
  tags: tagsField.default([]),
  note: linkFields.note.default(""),
  isPublic: z.boolean().default(false),
  readLater: z.boolean().default(false),
})

export const updateLinkInput = z.object({ id: z.uuid(), ...linkFields })

export const setLinkFlagsInput = z.object({
  id: z.uuid(),
  isPublic: z.boolean().optional(),
  readLater: z.boolean().optional(),
})

export const linkIdInput = z.object({ id: z.uuid() })

const linkIds = z.array(z.uuid()).min(1).max(500)
export const linkIdsInput = z.object({ ids: linkIds })
export const setLinksFlagsInput = z.object({
  ids: linkIds,
  isPublic: z.boolean().optional(),
  readLater: z.boolean().optional(),
})

export const listLinksInput = z.object({
  limit: z.number().int().min(1).max(500).default(200),
  query: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(32).optional(),
  readLater: z.boolean().optional(),
  isPublic: z.boolean().optional(),
})

export type Link = {
  id: string
  url: string
  title: string
  description: string
  site_name: string
  favicon_url: string
  tags: string[]
  note: string
  is_public: boolean
  read_later: boolean
  created_at: string
  updated_at: string
}

/** Everything needed to put a deleted link back exactly as it was (Undo). */
export const restoreLinkInput = z.object({
  id: z.uuid(),
  url: urlField,
  title: linkFields.title,
  description: z.string().max(1000),
  site_name: z.string().max(200),
  favicon_url: z.string().max(2048),
  tags: tagsField,
  note: linkFields.note,
  is_public: z.boolean(),
  read_later: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
})

export const noInput = z.object({})
