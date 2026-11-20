/**
 * Draws the anwar.os mark and writes every icon the app and the PWA need.
 * The SVG below is the source of truth; PNGs are rasterised by Playwright's
 * Chromium (already a dev dependency for e2e), so no image service or native
 * image library is involved.
 *
 *   pnpm icons        # after `pnpm exec playwright install chromium`
 *
 * Writes:
 *   src/app/icon.svg               favicon for modern browsers (Next metadata file)
 *   src/app/favicon.ico            16/32/48 px PNG-in-ICO for everything else
 *   src/app/apple-icon.png         180 px, opaque, full bleed (iOS adds its own mask)
 *   public/icons/icon-192.png      manifest "any"
 *   public/icons/icon-512.png      manifest "any"
 *   public/icons/maskable-512.png  manifest "maskable" (mark inside the 80 % safe zone)
 *   public/icons/monochrome.svg    manifest "monochrome" (Android themed icons)
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// Planuj Glass accent scale (globals.css).
const accent = { 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 900: "#312e81", 950: "#1e1b4b" }

/**
 * The mark: a single-storey "a" (a ring and its stem) followed by the ".os" dot,
 * white on an indigo tile with a frosted highlight, like a Planuj Glass card
 * lit from the top left. Drawn on a 512 grid, centred on (256, 256).
 */
function glyph({ dot = accent[200], ink = "#ffffff" } = {}) {
  return `
    <g transform="translate(14 -12)">
      <circle cx="210" cy="268" r="86" fill="none" stroke="${ink}" stroke-width="46"/>
      <rect x="273" y="159" width="46" height="218" rx="23" fill="${ink}"/>
      <circle cx="370" cy="352" r="25" fill="${dot}"/>
    </g>`
}

function tile({ radius, glyphScale = 1 }: { radius: number; glyphScale?: number }) {
  const t = glyphScale === 1 ? "" : `transform="translate(256 256) scale(${glyphScale}) translate(-256 -256)"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent[500]}"/>
      <stop offset="0.55" stop-color="${accent[600]}"/>
      <stop offset="1" stop-color="${accent[700]}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.22" cy="0.12" r="0.75">
      <stop offset="0" stop-color="${accent[300]}" stop-opacity="0.75"/>
      <stop offset="1" stop-color="${accent[300]}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.04"/>
    </linearGradient>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="${accent[950]}" flood-opacity="0.35"/>
    </filter>
    <clipPath id="clip"><rect width="512" height="512" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect width="512" height="512" fill="url(#glow)"/>
    <path d="M0 0H512V196C392 248 196 262 0 226Z" fill="url(#sheen)"/>
    ${radius ? `<rect x="1.5" y="1.5" width="509" height="509" rx="${radius - 1.5}" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="3"/>` : ""}
    <g filter="url(#lift)" ${t}>${glyph()}</g>
  </g>
</svg>
`
}

// "any" icons: a rounded tile with a transparent corner, like an app icon.
const anyIcon = tile({ radius: 116 })
// Full bleed: the platform masks it (Android circle/squircle, iOS rounded square).
const maskable = tile({ radius: 0, glyphScale: 0.78 })
const apple = tile({ radius: 0, glyphScale: 0.9 })
// Android 13+ themed icons: a single-colour silhouette on transparency.
const monochrome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyph({ dot: "#000", ink: "#000" }).replace(
  'transform="translate(14 -12)"',
  'transform="translate(256 256) scale(0.78) translate(-242 -268)"',
)}</svg>
`

function write(path: string, data: string | Buffer) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, data)
  console.log(`wrote ${path}`)
}

/** ICO container holding PNG images (supported everywhere since Windows Vista). */
function ico(pngs: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  async function png(svg: string, size: number, opaque = false) {
    await page.setViewportSize({ width: size, height: size })
    const background = opaque ? accent[600] : "transparent"
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:${background}}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`,
    )
    await page.locator("img").evaluate((img: HTMLImageElement) => img.decode())
    return page.screenshot({ omitBackground: !opaque, clip: { x: 0, y: 0, width: size, height: size } })
  }

  write("src/app/icon.svg", anyIcon)
  write("public/icons/icon-192.png", await png(anyIcon, 192))
  write("public/icons/icon-512.png", await png(anyIcon, 512))
  write("public/icons/maskable-512.png", await png(maskable, 512, true))
  write("public/icons/monochrome.svg", monochrome)
  write("src/app/apple-icon.png", await png(apple, 180, true))
  const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(anyIcon, size) })))
  write("src/app/favicon.ico", ico(small))
} finally {
  await browser.close()
}
