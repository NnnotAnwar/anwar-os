import { lookup as dnsLookup } from "node:dns/promises"
import http, { type IncomingMessage } from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib"
import type { Readable } from "node:stream"
import { extractMetadata, sniffCharset, type PageMetadata } from "./html-meta"
import { BlockedUrlError, checkUrl, hostnameOf, resolvePublic, strictPolicy, type GuardPolicy, type LookupAll } from "./url-guard"

// Fetches a page's preview metadata for a user-supplied URL, defensively:
// http(s) only, every hop re-checked against the SSRF guard, the address is
// re-validated at connect time (no DNS rebinding window), 5 s for the whole
// chain, at most 3 redirects, text/html only, and no more than 1 MB read
// (after decompression, so a zip bomb can't get past it).

export type FetchOptions = {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  lookupAll?: LookupAll
  policy?: GuardPolicy
}

export class MetadataFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MetadataFetchError"
  }
}

const defaultLookupAll: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })

const USER_AGENT = "Mozilla/5.0 (compatible; anwar.os link preview)"

export async function fetchPageMetadata(
  rawUrl: string,
  {
    timeoutMs = 5_000,
    maxBytes = 1_000_000,
    maxRedirects = 3,
    lookupAll = defaultLookupAll,
    policy = strictPolicy,
  }: FetchOptions = {},
): Promise<PageMetadata & { finalUrl: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new MetadataFetchError("timed out")), timeoutMs)
  try {
    let current = rawUrl
    for (let hop = 0; ; hop++) {
      const checked = checkUrl(current, policy)
      if (!checked.ok) throw new BlockedUrlError(checked.reason)
      const url = checked.url
      const result = await requestOnce(url, { lookupAll, policy, maxBytes, signal: controller.signal })
      if (result.kind === "redirect") {
        if (hop >= maxRedirects) throw new MetadataFetchError("too many redirects")
        current = new URL(result.location, url).href
        continue
      }
      return { ...extractMetadata(result.html, url), finalUrl: url.href }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new MetadataFetchError("timed out")
    throw error
  } finally {
    clearTimeout(timer)
  }
}

type Hop = { kind: "redirect"; location: string } | { kind: "page"; html: string }

function requestOnce(
  url: URL,
  ctx: { lookupAll: LookupAll; policy: GuardPolicy; maxBytes: number; signal: AbortSignal },
): Promise<Hop> {
  // Resolution happens here, at connect time, and refuses private addresses.
  // Node skips `lookup` for IP literals, which checkUrl() already vetted.
  const lookup: LookupFunction = (hostname, options, callback) => {
    resolvePublic(hostname.replace(/^\[|\]$/g, ""), ctx.lookupAll, ctx.policy).then(
      (addresses) => {
        const wanted = options.family === 4 || options.family === 6 ? addresses.filter((a) => a.family === options.family) : addresses
        const list = wanted.length ? wanted : addresses
        if (options.all) (callback as (e: null, a: typeof list) => void)(null, list)
        else callback(null, list[0]!.address, list[0]!.family)
      },
      (error: Error) => callback(error as NodeJS.ErrnoException, "", 0),
    )
  }

  const client = url.protocol === "https:" ? https : http
  return new Promise<Hop>((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "GET",
        lookup,
        agent: false,
        signal: ctx.signal,
        servername: url.protocol === "https:" ? hostnameOf(url) : undefined,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en,cs;q=0.8,ru;q=0.6",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy()
          const location = res.headers.location
          if (!location) return reject(new MetadataFetchError("redirect without a location"))
          return resolve({ kind: "redirect", location })
        }
        if (status < 200 || status >= 300) {
          res.destroy()
          return reject(new MetadataFetchError(`status ${status}`))
        }
        const type = (res.headers["content-type"] ?? "").toLowerCase()
        if (!/^\s*(text\/html|application\/xhtml\+xml)\b/.test(type)) {
          res.destroy()
          return reject(new MetadataFetchError("not an HTML page"))
        }
        readLimited(res, ctx.maxBytes).then((bytes) => resolve({ kind: "page", html: decode(bytes, type) }), reject)
      },
    )
    req.on("error", (error) => reject(ctx.signal.aborted ? new MetadataFetchError("timed out") : error))
    req.end()
  })
}

function decoderFor(res: IncomingMessage): Readable {
  const encoding = (res.headers["content-encoding"] ?? "identity").toLowerCase().trim()
  switch (encoding) {
    case "identity":
    case "":
      return res
    case "gzip":
    case "x-gzip":
      return res.pipe(createGunzip())
    case "deflate":
      return res.pipe(createInflate())
    case "br":
      return res.pipe(createBrotliDecompress())
    default:
      throw new MetadataFetchError(`unsupported encoding ${encoding}`)
  }
}

/** Reads at most `maxBytes` of the decoded body, stopping early once </head> has arrived. */
async function readLimited(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const stream = decoderFor(res)
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const room = maxBytes - total
      chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk)
      total += Math.min(chunk.length, room)
      if (total >= maxBytes) break
      if (/<\/head\s*>|<body[\s>]/i.test(chunk.toString("latin1"))) break
    }
  } finally {
    res.destroy()
    if (stream !== res) stream.destroy()
  }
  return Buffer.concat(chunks)
}

function decode(bytes: Buffer, contentType: string) {
  const declared =
    contentType.match(/charset=["']?([\w-]+)/)?.[1] ?? sniffCharset(bytes.subarray(0, 2048).toString("latin1"))
  try {
    return new TextDecoder(declared ?? "utf-8").decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}
