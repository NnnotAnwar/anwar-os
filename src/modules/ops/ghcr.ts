import "server-only"
import type { ImageTag } from "./schema"
import { ghcrPath, mergeTags, type Commit } from "./lib/tags"

// Recent image tags for the deploy dialog. Tags come from the GHCR registry API
// (an anonymous pull token works for public packages; GITHUB_TOKEN for private
// ones), commit messages from the GitHub API for GITHUB_REPO (public repos work
// without a token, at 60 requests an hour).

const TIMEOUT = 6_000

function githubToken() {
  return process.env.GITHUB_TOKEN || null
}

async function registryToken(path: string): Promise<string | null> {
  const token = githubToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Basic ${Buffer.from(`token:${token}`).toString("base64")}`
  const res = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${path}:pull`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { token?: string }
  return body.token ?? null
}

async function listTags(path: string): Promise<string[]> {
  const token = await registryToken(path)
  if (!token) throw new Error("GHCR refused a pull token (private package without GITHUB_TOKEN?).")
  const res = await fetch(`https://ghcr.io/v2/${path}/tags/list?n=1000`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) throw new Error(`GHCR answered ${res.status} for ${path}.`)
  const body = (await res.json()) as { tags?: string[] | null }
  return body.tags ?? []
}

async function recentCommits(): Promise<Commit[]> {
  const repo = process.env.GITHUB_REPO || "NnnotAnwar/anwarnnnot"
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return []
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  const token = githubToken()
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits?sha=main&per_page=60`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return []
    const rows = (await res.json()) as { sha: string; commit: { message: string; committer?: { date?: string }; author?: { date?: string } } }[]
    return rows.map((r) => ({
      sha: r.sha,
      message: r.commit.message,
      date: r.commit.committer?.date ?? r.commit.author?.date ?? "",
    }))
  } catch {
    return [] // tags still work without messages
  }
}

export type TagsResult = { ok: true; tags: ImageTag[] } | { ok: false; error: string }

export async function imageTags(image: string, currentTag: string): Promise<TagsResult> {
  const path = ghcrPath(image)
  if (!path) return { ok: false, error: "Only GHCR images list their tags here. Type a tag instead." }
  try {
    const [tags, commits] = await Promise.all([listTags(path), recentCommits()])
    return { ok: true, tags: mergeTags(tags, commits, currentTag) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't load tags from GHCR." }
  }
}
