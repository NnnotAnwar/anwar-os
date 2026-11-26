// Finding a card in a photo and flattening it, in plain TypeScript on pixel
// arrays (no OpenCV): the scanner runs on the phone and the photo never leaves
// it. Pure functions, unit-tested in geometry.test.ts.

export type Point = { x: number; y: number }
/** Corners clockwise from the top left: TL, TR, BR, BL. */
export type Quad = [Point, Point, Point, Point]
/** RGBA pixels, like the browser's ImageData. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray }

/** Width / height of an ID-1 card (bank card, ID, residence permit) and of a passport's data page. */
export const CARD_RATIO = 85.6 / 54
export const PASSPORT_RATIO = 125 / 88

/** The side the detector works at: plenty for a card's outline, fast on a phone. */
const WORK_SIDE = 480

function luminance({ width, height, data }: Pixels) {
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!
  return gray
}

/** Area-average downscale of a gray image so its longer side is at most `side`. */
function downscale(gray: Float32Array, width: number, height: number, side: number) {
  const scale = Math.min(1, side / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const out = new Float32Array(w * h)
  const count = new Float32Array(w * h)
  for (let y = 0; y < height; y++) {
    const ty = Math.min(h - 1, Math.floor(y * scale))
    for (let x = 0; x < width; x++) {
      const t = ty * w + Math.min(w - 1, Math.floor(x * scale))
      out[t]! += gray[y * width + x]!
      count[t]! += 1
    }
  }
  for (let i = 0; i < out.length; i++) out[i]! /= count[i]! || 1
  return { gray: out, width: w, height: h, scale: w / width }
}

function boxBlur(src: Float32Array, w: number, h: number) {
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += src[yy * w + xx]!
          n++
        }
      }
      out[y * w + x] = sum / n
    }
  }
  return out
}

function sobel(src: Float32Array, w: number, h: number) {
  const mag = new Float32Array(src.length)
  const at = (x: number, y: number) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
      mag[y * w + x] = Math.hypot(gx, gy)
    }
  }
  return mag
}

/** Otsu's threshold over a 256-bin histogram of `values`. */
export function otsu(values: Float32Array) {
  let max = 0
  for (const v of values) if (v > max) max = v
  if (max === 0) return 0
  const bins = new Float64Array(256)
  for (const v of values) bins[Math.min(255, Math.floor((v / max) * 255))]! += 1
  const total = values.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * bins[i]!
  let sumB = 0
  let weightB = 0
  let best = 0
  let threshold = 0
  for (let i = 0; i < 256; i++) {
    weightB += bins[i]!
    if (weightB === 0) continue
    const weightF = total - weightB
    if (weightF === 0) break
    sumB += i * bins[i]!
    const mB = sumB / weightB
    const mF = (sum - sumB) / weightF
    const between = weightB * weightF * (mB - mF) ** 2
    if (between > best) {
      best = between
      threshold = i
    }
  }
  return ((threshold + 0.5) / 255) * max
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number) {
  let cur = mask
  for (let r = 0; r < radius; r++) {
    const next = new Uint8Array(cur)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (cur[y * w + x]) continue
        if ((x > 0 && cur[y * w + x - 1]) || (x < w - 1 && cur[y * w + x + 1]) || (y > 0 && cur[(y - 1) * w + x]) || (y < h - 1 && cur[(y + 1) * w + x])) {
          next[y * w + x] = 1
        }
      }
    }
    cur = next
  }
  return cur
}

/** Pixels reachable from the image border without crossing an edge: the background around the card. */
function floodFromBorder(edges: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (i: number) => {
    if (!seen[i] && !edges[i]) {
      seen[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w)
    if (i < w * (h - 1)) push(i + w)
  }
  return seen
}

/** The largest 4-connected region of `mask`: its area, its outline (each row's and column's outermost pixels). */
function largestRegion(mask: Uint8Array, w: number, h: number) {
  const label = new Int32Array(w * h).fill(-1)
  let best: { area: number; points: Point[] } = { area: 0, points: [] }
  let next = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] !== -1) continue
    const id = next++
    const rows = new Map<number, [number, number]>()
    const cols = new Map<number, [number, number]>()
    let area = 0
    const stack = [start]
    label[start] = id
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w
      const y = (i - x) / w
      area++
      const row = rows.get(y)
      if (!row) rows.set(y, [x, x])
      else {
        if (x < row[0]) row[0] = x
        if (x > row[1]) row[1] = x
      }
      const col = cols.get(x)
      if (!col) cols.set(x, [y, y])
      else {
        if (y < col[0]) col[0] = y
        if (y > col[1]) col[1] = y
      }
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (n >= 0 && mask[n] && label[n] === -1) {
          label[n] = id
          stack.push(n)
        }
      }
    }
    if (area > best.area) {
      const points: Point[] = []
      for (const [y, [a, b]] of rows) points.push({ x: a, y: y + 0.5 }, { x: b + 1, y: y + 0.5 })
      for (const [x, [a, b]] of cols) points.push({ x: x + 0.5, y: a }, { x: x + 0.5, y: b + 1 })
      best = { area, points }
    }
  }
  return best
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Convex hull, counter-clockwise in image coordinates (monotone chain). */
export function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const lower: Point[] = []
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0) lower.pop()
    lower.push(pt)
  }
  const upper: Point[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0) upper.pop()
    upper.push(pt)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

export function polygonArea(points: Point[]) {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

/** The four hull vertices spanning the largest quadrilateral (a card's corners). */
function quadFromHull(hull: Point[]): Point[] {
  if (hull.length <= 4) return hull
  // Start from the extremes along the diagonals, then let each corner move to
  // the hull vertex that grows the area most, until nothing improves.
  const pick = (score: (p: Point) => number) => hull.reduce((best, p, i) => (score(p) > score(hull[best]!) ? i : best), 0)
  let idx = [pick((p) => -p.x - p.y), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => -p.x + p.y)]
  idx = [...new Set(idx)].sort((a, b) => a - b)
  while (idx.length < 4) idx.push((idx[idx.length - 1]! + Math.floor(hull.length / 4)) % hull.length)
  idx.sort((a, b) => a - b)
  let area = polygonArea(idx.map((i) => hull[i]!))
  for (let round = 0; round < 8; round++) {
    let improved = false
    for (let k = 0; k < 4; k++) {
      const prev = idx[(k + 3) % 4]!
      const next = idx[(k + 1) % 4]!
      for (let j = (prev + 1) % hull.length; j !== next; j = (j + 1) % hull.length) {
        const trial = [...idx]
        trial[k] = j
        const a = polygonArea(trial.map((i) => hull[i]!))
        if (a > area + 1e-6) {
          area = a
          idx = trial
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return idx.map((i) => hull[i]!)
}

/** Any four corners in clockwise order starting from the top left (smallest x + y). */
export function orderCorners(points: Point[]): Quad {
  const c = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length }
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x))
  const start = sorted.reduce((best, p, i) => (p.x + p.y < sorted[best]!.x + sorted[best]!.y ? i : best), 0)
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]!) as Quad
}

/**
 * Where the corners start when no card is found: just inside the photo's
 * edges, so a photo that's already only the card stays whole.
 */
export function defaultQuad(width: number, height: number, inset = 0.02): Quad {
  const dx = width * inset
  const dy = height * inset
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ]
}

type Line = { p: Point; d: Point }

/** The total-least-squares line through `points` (a point on it and its unit direction). */
function fitLine(points: Point[]): Line {
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length
  const my = points.reduce((s, p) => s + p.y, 0) / points.length
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of points) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2
  return { p: { x: mx, y: my }, d: { x: Math.cos(angle), y: Math.sin(angle) } }
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.d.x * b.d.y - a.d.y * b.d.x
  if (Math.abs(det) < 1e-6) return null
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / det
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t }
}

/**
 * Sharp corners for a card with rounded ones: a line through each side's
 * outline (its middle part, away from the rounded corners), moved `inset`
 * towards the middle, and the corners where neighbouring lines meet. Keeps
 * `quad` when a side has too few outline points to fit.
 */
function refineCorners(quad: Quad, outline: Point[], inset: number): Quad {
  const center = { x: quad.reduce((s, p) => s + p.x, 0) / 4, y: quad.reduce((s, p) => s + p.y, 0) / 4 }
  const lines: Line[] = []
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!
    const b = quad[(i + 1) % 4]!
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    const near = outline.filter((p) => {
      const t = ((p.x - a.x) * dir.x + (p.y - a.y) * dir.y) / len
      const off = Math.abs((p.x - a.x) * dir.y - (p.y - a.y) * dir.x)
      return t > 0.15 && t < 0.85 && off < Math.max(3, len * 0.04)
    })
    if (near.length < 8) return quad
    const line = fitLine(near)
    // Move the line `inset` towards the quad's middle (the outline lies just outside the edge).
    const normal = { x: -line.d.y, y: line.d.x }
    const side = (center.x - line.p.x) * normal.x + (center.y - line.p.y) * normal.y > 0 ? 1 : -1
    lines.push({ p: { x: line.p.x + normal.x * inset * side, y: line.p.y + normal.y * inset * side }, d: line.d })
  }
  const corners: Point[] = []
  for (let i = 0; i < 4; i++) {
    const c = intersect(lines[(i + 3) % 4]!, lines[i]!)
    if (!c) return quad
    corners.push(c)
  }
  return orderCorners(corners)
}

export type Detection = { quad: Quad; found: boolean }

/**
 * Finds the card: edges (Sobel, Otsu), the background flooded in from the
 * photo's border, and the four corners of what's left. `found` is false (and
 * the quad an inset rectangle) when the result doesn't look like a card, so
 * the owner drags the corners instead.
 */
export function detectCard(image: Pixels): Detection {
  const fallback = { quad: defaultQuad(image.width, image.height), found: false }
  const small = downscale(luminance(image), image.width, image.height, WORK_SIDE)
  const { width: w, height: h } = small
  const mag = sobel(boxBlur(boxBlur(small.gray, w, h), w, h), w, h)
  const t = otsu(mag)
  const edges = new Uint8Array(w * h)
  for (let i = 0; i < mag.length; i++) edges[i] = mag[i]! > t ? 1 : 0
  const RADIUS = 2
  const INSET = 2.5
  const closed = dilate(edges, w, h, RADIUS)
  const background = floodFromBorder(closed, w, h)
  const card = new Uint8Array(w * h)
  for (let i = 0; i < card.length; i++) card[i] = background[i] ? 0 : 1
  const region = largestRegion(card, w, h)
  const share = region.area / (w * h)
  if (share < 0.12 || share > 0.97) return fallback
  const hull = convexHull(region.points)
  const corners = quadFromHull(hull)
  if (corners.length !== 4) return fallback
  // The region ends on the outer side of the dilated edge band: the sides
  // move back in by that much. Then back to the photo's own size.
  const quad = refineCorners(orderCorners(corners), region.points, INSET)
  const scaled = quad.map((p) => ({ x: p.x / small.scale, y: p.y / small.scale })) as Quad
  // A card is convex with roughly a card's proportions; a sliver isn't.
  const area = polygonArea(scaled)
  const box = area / (image.width * image.height)
  const { ratio } = measure(scaled)
  if (box < 0.1 || ratio > 3 || ratio < 1 / 3) return fallback
  return { quad: scaled, found: true }
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** The quad's average width and height, and width / height. */
export function measure(q: Quad) {
  const width = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2
  const height = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2
  return { width, height, ratio: width / (height || 1) }
}

/** Turns the quad a quarter turn (its next corner becomes the top left): for a card shot sideways. */
export function rotateQuad(q: Quad, turns = 1): Quad {
  const k = ((turns % 4) + 4) % 4
  return [0, 1, 2, 3].map((i) => q[(i + k) % 4]!) as Quad
}

/**
 * The flat card's size for `quad`: landscape (a card photographed sideways is
 * turned), its measured proportions snapped to a card's or a passport page's
 * when close, `long` pixels wide.
 */
export function outputFor(quad: Quad, long = 1600): { quad: Quad; width: number; height: number } {
  let q = quad
  let { ratio } = measure(q)
  if (ratio < 1) {
    q = rotateQuad(q, 1)
    ratio = 1 / ratio
  }
  for (const known of [CARD_RATIO, PASSPORT_RATIO]) if (Math.abs(ratio - known) / known < 0.08) ratio = known
  return { quad: q, width: long, height: Math.round(long / ratio) }
}

/**
 * The homography that maps the output rectangle (0,0)…(w,h) onto `quad`:
 * for each output pixel, where to sample the photo.
 */
export function homography(quad: Quad, w: number, h: number): number[] {
  const dst = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ] as const
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i]!
    const { x: u, y: v } = quad[i]!
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  // Gaussian elimination with partial pivoting on the 8×8 system.
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r
    ;[a[col], a[pivot]] = [a[pivot]!, a[col]!]
    ;[b[col], b[pivot]] = [b[pivot]!, b[col]!]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = a[r]![col]! / a[col]![col]!
      for (let c = col; c < 8; c++) a[r]![c]! -= f * a[col]![c]!
      b[r]! -= f * b[col]!
    }
  }
  return [...b.map((v, i) => v / a[i]![i]!), 1]
}

/** Samples `src` through the homography into a new `w`×`h` image (bilinear). */
export function warp(src: Pixels, quad: Quad, w: number, h: number): Pixels {
  const H = homography(quad, w, h)
  const out = new Uint8ClampedArray(w * h * 4)
  const { width: sw, height: sh, data } = src
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const z = H[6]! * px + H[7]! * py + H[8]!
      const u = (H[0]! * px + H[1]! * py + H[2]!) / z - 0.5
      const v = (H[3]! * px + H[4]! * py + H[5]!) / z - 0.5
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(u)))
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(v)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const fx = Math.max(0, Math.min(1, u - x0))
      const fy = Math.max(0, Math.min(1, v - y0))
      const o = (y * w + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = data[(y0 * sw + x0) * 4 + c]! * (1 - fx) + data[(y0 * sw + x1) * 4 + c]! * fx
        const bottom = data[(y1 * sw + x0) * 4 + c]! * (1 - fx) + data[(y1 * sw + x1) * 4 + c]! * fx
        out[o + c] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return { width: w, height: h, data: out }
}

/** The image turned half a turn (a card photographed upside down). */
export function rotate180({ width, height, data }: Pixels): Pixels {
  const out = new Uint8ClampedArray(data.length)
  const n = width * height
  for (let i = 0; i < n; i++) {
    const j = n - 1 - i
    out[j * 4] = data[i * 4]!
    out[j * 4 + 1] = data[i * 4 + 1]!
    out[j * 4 + 2] = data[i * 4 + 2]!
    out[j * 4 + 3] = data[i * 4 + 3]!
  }
  return { width, height, data: out }
}
