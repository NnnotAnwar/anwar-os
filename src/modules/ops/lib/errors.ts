import { createHash } from "node:crypto"
import type { OpsErrorRouteType, OpsErrorSource } from "@/db/schema/ops"

// The error log's rules (Ops → Errors): how a thrown error becomes a stored,
// grouped record, and how the list and the Telegram alerts read it back.
// Pure (node:crypto only), so every rule is unit-tested (errors.test.ts).
//
// What is kept: the error's name, its message and a short stack, all scrubbed
// of anything that looks like a secret, a token or an email address; the route
// pattern (never the query string); the method; where in Next it happened.
// Never request bodies, headers, cookies or the environment.
//
// Grouping: errors with the same fingerprint are one group. The fingerprint is
// the source, the name, the message with everything that varies per occurrence
// (ids, numbers, quoted values) replaced, and the top frame of our own code
// with line numbers and build hashes removed, so one bug stays one group
// across requests and deploys.

export const ERROR_LIMITS = {
  name: 120,
  message: 1000,
  route: 300,
  stack: 6000,
  stackFrames: 12,
  stackLine: 300,
} as const

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

const SECRET_WORDS =
  "password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|authorization|cookie|session(?:id)?|signature|credentials?|client[_-]?secret|otp|totp"

/** name=value, name: value, "name":"value" where the name says it's secret. */
const SECRET_PAIR = new RegExp(`\\b([\\w.-]*(?:${SECRET_WORDS})[\\w.-]*)(["']?\\s*[:=]\\s*["']?)([^\\s"'&,;)}\\]]+)`, "gi")

const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  // Private keys, whole blocks.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "<private key>"],
  [/AGE-SECRET-KEY-1[0-9A-Z]+/g, "<private key>"],
  // Credentials in URLs: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1<redacted>@"],
  // Query strings of URLs (tokens love them).
  [/(\bhttps?:\/\/[^\s?#"'<>]+)\?[^\s"'<>#]*/gi, "$1?<redacted>"],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 <redacted>"],
  // Well-known token shapes.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "<jwt>"],
  [/\baos_[A-Za-z0-9_-]{10,}/g, "<token>"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "<token>"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "<token>"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "<token>"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "<token>"],
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "<token>"], // Telegram bot token
  [SECRET_PAIR, (_m, key: string, sep: string) => `${key}${sep}<redacted>`],
  // drizzle's "Failed query: … params: a,b,c": the parameters are user data.
  [/(\bparams:\s*)[^\n]*/gi, "$1<redacted>"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  // Long opaque strings: hex secrets, and random base64 with upper, lower and digits.
  [/\b[0-9a-f]{40,}\b/gi, "<hex>"],
  [
    /[A-Za-z0-9+/_-]{40,}={0,2}/g,
    (m: string) => (/[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) && !m.includes("/") ? "<token>" : m),
  ],
]

/** Removes what looks like a secret, a token or an email address. */
export function scrub(text: string): string {
  let out = text
  for (const [re, to] of RULES) out = out.replace(re, to as string)
  return out
}

/** A request path without its query string or fragment. */
export function stripQuery(path: string): string {
  const i = path.search(/[?#]/)
  return i === -1 ? path : path.slice(0, i)
}

/** "/(private)/app/notes/[id]" → "/app/notes/[id]"; "/app/page" → "/app". */
export function displayRoute(route: string): string {
  const out = stripQuery(route)
    .replace(/\/\([^/)]+\)(?=\/|$)/g, "")
    .replace(/\/(page|route)$/, "")
  return out || "/"
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** The message with everything that varies per occurrence replaced: the fingerprint's input. */
export function normalizeMessage(message: string): string {
  return scrub(message)
    .replace(UUID, "<id>")
    .replace(/<(?:token|jwt|hex|email|redacted|private key)>/g, "<x>")
    .replace(/(["'`])(?:(?!\1)[^\n]){0,200}\1/g, "$1…$1")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/\b\d+(?:[.,:]\d+)*\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

// ---------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------

export type Frame = { fn: string; file: string; line: number | null; raw: string }

const FRAME = /^\s*at\s+(?:(.*?)\s+\((.*)\)|(.*))\s*$/

function splitLocation(loc: string): { file: string; line: number | null } {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(loc)
  return m ? { file: m[1]!, line: Number(m[2]) } : { file: loc, line: null }
}

const PY_FRAME = /^\s*File "(.*)", line (\d+), in (.+?)\s*$/

/**
 * Frames, innermost first: a V8 stack ("    at fn (file:1:2)") or a Python
 * traceback ('  File "x.py", line 3, in fn', innermost last, so reversed).
 * Other lines are skipped.
 */
export function parseFrames(stack: string): Frame[] {
  const frames: Frame[] = []
  if (stack.includes("Traceback (most recent call last)")) {
    for (const raw of stack.split("\n")) {
      const m = PY_FRAME.exec(raw)
      if (m) frames.push({ fn: m[3]!.replace(/^<module>$/, ""), file: m[1]!, line: Number(m[2]), raw: raw.trim() })
    }
    return frames.reverse()
  }
  for (const raw of stack.split("\n")) {
    const m = FRAME.exec(raw)
    if (!m) continue
    const fn = (m[1] ?? "").replace(/^async\s+/, "").replace(/^new\s+/, "")
    const { file, line } = splitLocation(m[2] ?? m[3] ?? "")
    frames.push({ fn, file, line, raw: raw.trim() })
  }
  return frames
}

/** Paths without the machine: no file://, bundler prefixes, working directory or home directory. */
export function cleanPath(file: string, cwd = ""): string {
  let out = file
    .replace(/^file:\/\//, "")
    .replace(/^webpack-internal:\/\/\/(?:\([a-z-]+\)\/)?/, "")
    .replace(/^turbopack:\/\/\/(?:\[project\]\/)?/, "")
  if (cwd && out.startsWith(cwd)) out = out.slice(cwd.length).replace(/^\/+/, "")
  return out
    .replace(/^\/(?:Users|home)\/[^/]+\//, "~/")
    .replace(/\?.*$/, "")
    .replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/")
}

/** Our code, as opposed to Node, Next, React or a dependency. */
export function isAppFrame(f: Frame): boolean {
  const file = f.file
  if (!file || file === "<anonymous>" || file === "native") return false
  if (/^node:|^internal\//.test(file)) return false
  if (/node_modules|next\/dist|\[externals\]|react-server-dom|\/compiled\//.test(file)) return false
  if (/site-packages|dist-packages|\/lib\/python\d/.test(file)) return false
  // Turbopack names bundled dependencies "node_modules_<pkg>_…" (chunks of our own code don't).
  if (/(?:^|\/)(?:\[root-of-the-server\]__)?node_modules_/.test(file)) return false
  return true
}

/** One frame as a stable key: function and file, no line numbers, no build hashes. */
export function frameKey(f: Frame, cwd = ""): string {
  const file = cleanPath(f.file, cwd)
    .replace(/\.next\/(?:dev\/)?server\//, "")
    // Turbopack chunk hashes ("[root-of-the-server]__0zn7f-gkx2cbj._.js") and hex hashes anywhere.
    .replace(/__(?=[\w-]*\d)[\w-]{6,}(?=\._\.js$|\.js$)/, "")
    .replace(/[._-]*(?<![0-9a-z])(?=[0-9a-f]*\d)[0-9a-f]{6,}(?![0-9a-z])/gi, "")
    .replace(/\._\.js$/, ".js")
  // Minified names (a, t, eQ) change between builds; keep them out.
  const fn = f.fn.length > 2 ? f.fn.replace(/^Object\./, "") : ""
  return `${fn}@${file}`
}

/** The first frame of our own code, or the first frame at all, as a key. */
export function topFrameKey(stack: string, cwd = ""): string {
  const frames = parseFrames(stack)
  const top = frames.find(isAppFrame) ?? frames[0]
  return top ? frameKey(top, cwd) : ""
}

/**
 * The stack to store: the first line (scrubbed), then at most
 * ERROR_LIMITS.stackFrames frames with clean paths. Node's own frames are
 * dropped; runs of framework frames collapse to "… n more".
 */
export function trimStack(stack: string, header: string, cwd = ""): string {
  const lines = [clip(scrub(header), ERROR_LIMITS.stackLine)]
  const frames = parseFrames(stack).filter((f) => !/^node:|^internal\//.test(f.file))
  let kept = 0
  let skipped = 0
  for (const f of frames) {
    if (kept >= ERROR_LIMITS.stackFrames) {
      skipped++
      continue
    }
    const where = cleanPath(f.file, cwd) + (f.line != null ? `:${f.line}` : "")
    const line = `    at ${f.fn ? `${f.fn} (${where})` : where}`
    // Framework frames after the first few app frames are noise.
    if (!isAppFrame(f) && kept >= 4 && frames.slice(frames.indexOf(f)).every((g) => !isAppFrame(g))) {
      skipped++
      continue
    }
    lines.push(clip(scrub(line), ERROR_LIMITS.stackLine))
    kept++
  }
  if (skipped) lines.push(`    … ${skipped} more`)
  return clip(lines.join("\n"), ERROR_LIMITS.stack)
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// ---------------------------------------------------------------------------
// From a thrown value to a record
// ---------------------------------------------------------------------------

export type ErrorRecord = {
  source: OpsErrorSource
  fingerprint: string
  name: string
  message: string
  route: string
  method: string
  routeType: OpsErrorRouteType
  renderSource: string
  digest: string
  stack: string
}

export type ErrorContext = {
  source: OpsErrorSource
  /** Route pattern (Next's routePath) or a path; the query string is dropped. */
  route?: string
  method?: string
  routeType?: OpsErrorRouteType
  renderSource?: string
  /** For relative paths in the stack. */
  cwd?: string
}

type ErrorLike = { name: string; message: string; stack: string; digest: string; cause: unknown }

function asErrorLike(value: unknown): ErrorLike {
  if (value instanceof Error || (value && typeof value === "object" && "message" in value)) {
    const e = value as Partial<Error> & { digest?: unknown; cause?: unknown }
    const name = typeof e.name === "string" && e.name ? e.name : (value as object).constructor?.name || "Error"
    return {
      name,
      message: typeof e.message === "string" ? e.message : String(e.message ?? ""),
      stack: typeof e.stack === "string" ? e.stack : "",
      digest: typeof e.digest === "string" || typeof e.digest === "number" ? String(e.digest) : "",
      cause: e.cause,
    }
  }
  return { name: "NonError", message: typeof value === "string" ? value : safeString(value), stack: "", digest: "", cause: undefined }
}

function safeString(value: unknown): string {
  try {
    return typeof value === "object" ? JSON.stringify(value).slice(0, 500) : String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

// Next's control flow (redirect(), notFound(), dynamic bail-outs) arrives as
// thrown errors with these digests; they aren't failures. So is a client that
// went away mid-response.
const CONTROL_DIGEST = /^(?:NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|HANGING_PROMISE_REJECTION|NEXT_PRERENDER_INTERRUPTED)/

/** Should this thrown value stay out of the error log? */
export function isIgnorable(value: unknown): boolean {
  const e = asErrorLike(value)
  if (CONTROL_DIGEST.test(e.digest)) return true
  if (e.name === "ResponseAborted" || (e.name === "AbortError" && /aborted/i.test(e.message))) return true
  return false
}

export function fingerprint(parts: { source: string; name: string; message: string; frame: string }): string {
  return createHash("sha256")
    .update([parts.source, parts.name, normalizeMessage(parts.message), parts.frame].join("\n"))
    .digest("hex")
    .slice(0, 32)
}

/** Turns a thrown value into what app.record_error() stores, or null for Next's control flow. */
export function toErrorRecord(value: unknown, ctx: ErrorContext): ErrorRecord | null {
  if (isIgnorable(value)) return null
  const e = asErrorLike(value)
  const cwd = ctx.cwd ?? ""
  const name = clip(e.name.replace(/[^\w.$:-]/g, "") || "Error", ERROR_LIMITS.name)
  let message = scrub(e.message).trim()
  const cause = e.cause !== undefined && e.cause !== null ? asErrorLike(e.cause) : null
  let stack = e.stack ? trimStack(e.stack, `${name}: ${message}`, cwd) : ""
  if (cause && cause.message) {
    const causeLine = `Caused by ${cause.name}: ${scrub(cause.message)}`
    stack = clip(`${stack}${stack ? "\n" : ""}${cause.stack ? trimStack(cause.stack, causeLine, cwd) : causeLine}`, ERROR_LIMITS.stack)
    if (!message) message = scrub(cause.message)
  }
  message = clip(message, ERROR_LIMITS.message)
  return {
    source: ctx.source,
    fingerprint: fingerprint({ source: ctx.source, name, message, frame: e.stack ? topFrameKey(e.stack, cwd) : "" }),
    name,
    message,
    route: clip(ctx.route ? displayRoute(ctx.route) : "", ERROR_LIMITS.route),
    method: (ctx.method ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10),
    routeType: ctx.routeType ?? "",
    renderSource: (ctx.renderSource ?? "").slice(0, 60),
    digest: e.digest.slice(0, 100),
    stack,
  }
}
