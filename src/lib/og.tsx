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
 * Cached for good; if Fontshare can't be reached the card falls back to the
 * built-in face instead of failing the build.
 */
async function satoshi(): Promise<{ weight: 500 | 700; base64: string }[]> {
  "use cache"
  cacheLife("max")
  try {
    const css = await fetch("https://api.fontshare.com/v2/css?f[]=satoshi@500,700&display=swap", {
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.text())
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].flatMap(([, block]) => {
      const ttf = /url\('([^']+\.ttf)'\)\s*format\('truetype'\)/.exec(block!)?.[1]
      const weight = Number(/font-weight:\s*(\d+)/.exec(block!)?.[1])
      return ttf && (weight === 500 || weight === 700) ? [{ weight: weight as 500 | 700, url: ttf.startsWith("//") ? `https:${ttf}` : ttf }] : []
    })
    return await Promise.all(
      faces.map(async ({ weight, url }) => {
        const buffer = await fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) => r.arrayBuffer())
        return { weight, base64: Buffer.from(buffer).toString("base64") }
      }),
    )
  } catch {
    return []
  }
}

async function fonts(): Promise<Font[]> {
  return (await satoshi()).map(({ weight, base64 }) => {
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

export async function ogImage({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
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
              {title}
            </div>
            {subtitle && (
              <div style={{ display: "flex", color: soft, fontSize: 30, fontWeight: 500, lineHeight: 1.3, maxWidth: 900 }}>
                {subtitle.length > 140 ? `${subtitle.slice(0, 139).trimEnd()}…` : subtitle}
              </div>
            )}
          </div>
          <Ticks />
        </div>
      </div>
    ),
    { ...ogSize, fonts: loaded },
  )
}
