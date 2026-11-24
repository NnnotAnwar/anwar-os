/**
 * Content-Security-Policy for every HTML response, built per request in
 * src/proxy.ts with a fresh nonce. Pure (no Next imports) so it's unit-tested.
 *
 * Scripts: only those carrying the nonce, plus whatever they load
 * ('strict-dynamic'), so an injected <script> or inline handler never runs.
 * Next.js reads the nonce from the request's CSP header and stamps it on its own
 * scripts; the root layout stamps it on the theme's pre-paint script. That only works for HTML
 * rendered per request, which is why the root layout reads headers() (see the
 * note there): a prerendered static shell has no nonce.
 *
 * Styles allow 'unsafe-inline': React renders style="" attributes and sonner and
 * Base UI inject <style> at runtime. Style injection can't run code.
 */

export type CspEnv = {
  /** "development" adds 'unsafe-eval' (React's dev tooling) and ws: for HMR. */
  nodeEnv?: string
  /** BETTER_AUTH_URL: https sites also get upgrade-insecure-requests. */
  siteUrl?: string
  /** Browsers PUT uploads to and GET previews from object storage directly. */
  s3Endpoint?: string
  s3Bucket?: string
  s3ForcePathStyle?: string
}

/** Origins the browser talks to for files: the endpoint, or bucket.host when virtual-hosted. */
export function storageOrigins({ s3Endpoint, s3Bucket, s3ForcePathStyle }: CspEnv): string[] {
  if (!s3Endpoint) return []
  let url: URL
  try {
    url = new URL(s3Endpoint)
  } catch {
    return []
  }
  const origins = [url.origin]
  if (s3Bucket && s3ForcePathStyle !== "true") origins.push(`${url.protocol}//${s3Bucket}.${url.host}`)
  return origins
}

export function contentSecurityPolicy(nonce: string, env: CspEnv): string {
  const dev = env.nodeEnv === "development"
  const storage = storageOrigins(env)
  const https = env.siteUrl?.startsWith("https://") ?? false

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", "https://api.fontshare.com"],
    "font-src": ["'self'", "https://cdn.fontshare.com"],
    // Link favicons and project covers come from any https site.
    "img-src": ["'self'", "data:", "blob:", "https:", ...storage],
    "media-src": ["'self'", ...storage],
    "connect-src": ["'self'", ...storage, ...(dev ? ["ws:"] : [])],
    // PDF previews: an iframe on a same-origin URL that redirects to storage.
    "frame-src": ["'self'", ...storage],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Same intent as Caddy's X-Frame-Options: DENY (kept for old browsers).
    "frame-ancestors": ["'none'"],
  }

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`)
  if (https) policy.push("upgrade-insecure-requests")
  return policy.join("; ")
}

/** 128 random bits, base64: unguessable and unique per response. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}
