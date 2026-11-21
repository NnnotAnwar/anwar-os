import type { ImageTag } from "../schema"

export type Commit = { sha: string; message: string; date: string }

const SHA = /^[0-9a-f]{40}$/

/** "ghcr.io/owner/name" → "owner/name"; null for other registries. */
export function ghcrPath(image: string): string | null {
  const m = /^ghcr\.io\/([a-z0-9._-]+\/[a-z0-9._/-]+)$/.exec(image.toLowerCase())
  return m ? m[1]! : null
}

/**
 * The deploy dialog's list: sha tags matched to commits (newest first, with the
 * commit's first line), then other named tags. `latest` goes last: deploying it
 * doesn't say what you get.
 */
export function mergeTags(tags: string[], commits: Commit[], current: string, limit = 20): ImageTag[] {
  const set = new Set(tags)
  const out: ImageTag[] = []
  for (const c of commits) {
    if (set.has(c.sha)) {
      out.push({ tag: c.sha, sha: c.sha, message: firstLine(c.message), date: c.date, current: c.sha === current })
      set.delete(c.sha)
    }
  }
  const rest = [...set].filter((t) => !SHA.test(t)).sort((a, b) => (a === "latest" ? 1 : b === "latest" ? -1 : a.localeCompare(b)))
  for (const t of rest) out.push({ tag: t, current: t === current })
  // The running tag stays visible even if it's older than the window.
  const list = out.slice(0, limit)
  if (current && !list.some((t) => t.current) && tags.includes(current)) {
    list.push(out.find((t) => t.tag === current) ?? { tag: current, current: true })
  }
  return list
}

function firstLine(message: string) {
  const line = message.split("\n", 1)[0]!.trim()
  return line.length > 90 ? `${line.slice(0, 89)}…` : line
}
