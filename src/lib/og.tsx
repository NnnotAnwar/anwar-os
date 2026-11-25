import { readFile } from "node:fs/promises"
import { join, normalize } from "node:path"
import { ImageResponse } from "next/og"
import { cacheLife } from "next/cache"

// Social cards (Open Graph / Twitter) in the Planuj Glass look: the lilac
// canvas, one frosted card with a lit edge, an accent eyebrow, the title in
// Satoshi and the site's meridian ticks along the bottom.

export const ogSize = { width: 1200, height: 630 }
export const ogContentType = "image/png"

type Font = { name: string; data: ArrayBuffer; weight: 500 | 700; style: "normal" }

/**
 * Satoshi from Fontshare, the same source the site's CSS already loads it from.
 * Cached for good once it loads. A failure throws, so nothing is cached and the
 * next render tries again; fonts() then falls back to the built-in face.
 */
async function satoshi(): Promise<{ weight: 500 | 700; base64: string }[]> {
  "use cache"
  cacheLife("max")
  const css = await fetch("https://api.fontshare.com/v2/css?f[]=satoshi@500,700&display=swap", {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.text())
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].flatMap(([, block]) => {
    const ttf = /url\('([^']+\.ttf)'\)\s*format\('truetype'\)/.exec(block!)?.[1]
    const weight = Number(/font-weight:\s*(\d+)/.exec(block!)?.[1])
    return ttf && (weight === 500 || weight === 700) ? [{ weight: weight as 500 | 700, url: ttf.startsWith("//") ? `https:${ttf}` : ttf }] : []
  })
  if (!faces.length) throw new Error("Fontshare returned no Satoshi faces")
  return await Promise.all(
    faces.map(async ({ weight, url }) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`Fontshare font ${res.status}`)
      return { weight, base64: Buffer.from(await res.arrayBuffer()).toString("base64") }
    }),
  )
}

async function fonts(): Promise<Font[]> {
  const faces = await satoshi().catch((error: unknown) => {
    console.warn("og: Satoshi unavailable, using the built-in face", error)
    return []
  })
  return faces.map(({ weight, base64 }) => {
    const bytes = Buffer.from(base64, "base64")
    return {
      name: "Satoshi",
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      weight,
      style: "normal",
    }
  })
}

const ink = "#1b1a2e"
const soft = "#66637f"
const accent = "#4f46e5"

/** The longitude ruler from the hero: ink between home and Prague, the accent where Anwar is now. */
function Ticks() {
  const ticks = Array.from({ length: 71 }, (_, i) => 10 + i)
  return (
    <div style={{ display: "flex", alignItems: "flex-end", height: 56, gap: 0, width: "100%" }}>
      {ticks.map((lon) => {
        const prague = lon === 14
        const major = lon % 10 === 0
        const travelled = lon >= 14 && lon <= 67
        return (
          <div key={lon} style={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "flex-end" }}>
            <div
              style={{
                width: prague ? 6 : 2,
                height: prague ? 52 : major ? 28 : 16,
                borderRadius: 4,
                background: prague ? accent : travelled ? "rgba(27,26,46,0.55)" : "rgba(102,99,127,0.25)",
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Cut to `max` characters with an ellipsis, so a long title never runs off the card. */
function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const COVER_TYPES = new Set(["image/png", "image/jpeg", "image/gif"])
const COVER_MAX_BYTES = 4 * 1024 * 1024
const PUBLIC_DIR = join(process.cwd(), "public")

function sniffType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif"
  return null
}

/**
 * A cover as a data URL Satori can draw, cached for days. Covers on this site
 * (e.g. /case-studies/…) are read from public/ instead of fetched back through
 * the edge; others are fetched with a timeout. PNG, JPEG and GIF only (what
 * Satori decodes), at most 4 MB. Throws on anything else, so nothing is cached.
 */
async function coverDataUrl(src: string, siteOrigin: string): Promise<string> {
  "use cache"
  cacheLife("days")
  const url = new URL(src, siteOrigin)
  let bytes: Uint8Array
  if (url.origin === siteOrigin) {
    const file = normalize(join(PUBLIC_DIR, decodeURIComponent(url.pathname)))
    if (!file.startsWith(`${PUBLIC_DIR}/`)) throw new Error("og: cover outside public/")
    bytes = new Uint8Array(await readFile(file))
  } else {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("og: cover is not a web URL")
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "follow" })
    if (!res.ok) throw new Error(`og: cover ${res.status}`)
    if (Number(res.headers.get("content-length") ?? 0) > COVER_MAX_BYTES) throw new Error("og: cover too large")
    bytes = new Uint8Array(await res.arrayBuffer())
  }
  if (bytes.byteLength > COVER_MAX_BYTES) throw new Error("og: cover too large")
  const type = sniffType(bytes)
  if (!type || !COVER_TYPES.has(type)) throw new Error("og: cover is not PNG, JPEG or GIF")
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`
}

/** The cover to draw on a social card, or null (the card then shows title and tagline only). */
export async function ogCover(src: string | null | undefined, siteOrigin: string): Promise<string | null> {
  if (!src) return null
  try {
    return await coverDataUrl(src, siteOrigin)
  } catch (error) {
    console.warn("og: cover not drawn", error instanceof Error ? error.message : error)
    return null
  }
}

export async function ogImage({
  eyebrow,
  title,
  subtitle,
  image,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  /** A data URL (see ogCover): drawn on the right, with the text beside it. */
  image?: string | null
}) {
  const loaded = await fonts()
  const display = loaded.length ? "Satoshi" : undefined
  const long = title.length > 48
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 56,
          background:
            "radial-gradient(circle at 85% 10%, rgba(129,140,248,0.28), transparent 45%), linear-gradient(135deg, #f8f7fc 0%, #f5f4f9 50%, #eeecf7 100%)",
          fontFamily: display,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "52px 60px 44px",
            borderRadius: 32,
            background: "rgba(255,255,255,0.66)",
            border: "2px solid rgba(255,255,255,0.95)",
            boxShadow: "0 2px 4px rgba(27,26,46,0.05), 0 56px 112px -48px rgba(79,70,229,0.45)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div
                style={{
                  display: "flex",
                  color: accent,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                }}
              >
                {eyebrow}
              </div>
              <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: ink, letterSpacing: "-0.02em" }}>
                <span>anwar</span>
                <span style={{ color: accent, marginLeft: -6 }}>.os</span>
              </div>
            </div>
            {image ? (
              // With a picture (a project's cover): text on the left, the cover framed on the right.
              <div style={{ display: "flex", alignItems: "flex-start", gap: 40 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      color: ink,
                      fontSize: title.length > 36 ? 46 : 58,
                      fontWeight: 700,
                      lineHeight: 1.06,
                      letterSpacing: "-0.035em",
                    }}
                  >
                    {clip(title, 90)}
                  </div>
                  {subtitle && (
                    <div style={{ display: "flex", color: soft, fontSize: 24, fontWeight: 500, lineHeight: 1.3 }}>
                      {clip(subtitle, 110)}
                    </div>
                  )}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
                <img
                  src={image}
                  alt=""
                  width={440}
                  height={248}
                  style={{
                    width: 440,
                    height: 248,
                    objectFit: "cover",
                    borderRadius: 20,
                    border: "2px solid rgba(255,255,255,0.95)",
                    boxShadow: "0 24px 48px -24px rgba(79,70,229,0.45)",
                  }}
                />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <div
                  style={{
                    display: "flex",
                    color: ink,
                    fontSize: long ? 64 : 80,
                    fontWeight: 700,
                    lineHeight: 1.04,
                    letterSpacing: "-0.035em",
                    maxWidth: 960,
                  }}
                >
                  {clip(title, 110)}
                </div>
                {subtitle && (
                  <div style={{ display: "flex", color: soft, fontSize: 30, fontWeight: 500, lineHeight: 1.3, maxWidth: 900 }}>
                    {clip(subtitle, 140)}
                  </div>
                )}
              </div>
            )}
          </div>
          <Ticks />
        </div>
      </div>
    ),
    // No `fonts` key at all when Satoshi didn't load: an empty list makes
    // ImageResponse throw ("No fonts are loaded"), which failed the build when
    // Fontshare was unreachable from CI. Without the key it uses its own face.
    { ...ogSize, ...(loaded.length ? { fonts: loaded } : {}) },
  )
}
