import { describe, expect, it } from "vitest"
import {
  CARD_RATIO,
  convexHull,
  detectCard,
  homography,
  measure,
  orderCorners,
  outputFor,
  rotate180,
  warp,
  type Pixels,
  type Point,
  type Quad,
} from "./geometry"

/** A deterministic "random" for the background texture. */
function noise(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

function inside(q: Point[], p: Point) {
  let sign = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!
    const b = q[(i + 1) % q.length]!
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (c !== 0) {
      if (sign && Math.sign(c) !== sign) return false
      sign = Math.sign(c)
    }
  }
  return true
}

/** A light card (with dark "text" lines on it) on a dark, grainy table. */
function photo(width: number, height: number, card: Quad, seed = 1): Pixels {
  const rand = noise(seed)
  const data = new Uint8ClampedArray(width * height * 4)
  // The card's own frame, to draw text in its coordinates.
  const H = homography(card, 100, 63)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const onCard = inside(card, { x: x + 0.5, y: y + 0.5 })
      const g = onCard ? 225 + rand() * 20 : 40 + rand() * 45
      data[o] = g
      data[o + 1] = g
      data[o + 2] = onCard ? g : g + 10
      data[o + 3] = 255
    }
  }
  // Dark text lines inside the card (mapped from card space).
  for (let line = 0; line < 5; line++) {
    const cy = 12 + line * 9
    for (let cx = 10; cx < 80; cx += 0.25) {
      const z = H[6]! * cx + H[7]! * cy + H[8]!
      const u = Math.round((H[0]! * cx + H[1]! * cy + H[2]!) / z)
      const v = Math.round((H[3]! * cx + H[4]! * cy + H[5]!) / z)
      for (let t = 0; t < 2; t++) {
        const o = ((v + t) * width + u) * 4
        if (o >= 0 && o < data.length) data[o] = data[o + 1] = data[o + 2] = 30
      }
    }
  }
  return { width, height, data }
}

const near = (a: Point, b: Point, tolerance: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance

describe("detectCard", () => {
  it("finds a tilted card's four corners on a grainy table", () => {
    const card: Quad = [
      { x: 140, y: 120 },
      { x: 640, y: 90 },
      { x: 670, y: 410 },
      { x: 160, y: 450 },
    ]
    const { quad, found } = detectCard(photo(800, 560, card))
    expect(found).toBe(true)
    for (let i = 0; i < 4; i++) expect(near(quad[i]!, card[i]!, 8)).toBe(true)
  })

  it("finds the sharp corners of a card with rounded ones, tilted", () => {
    const W = 1200
    const H = 900
    for (const angle of [-0.12, 0.3]) {
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const data = new Uint8ClampedArray(W * H * 4)
      const rand = noise(3)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const u = cos * (x - 600) + sin * (y - 450) + 375
          const v = -sin * (x - 600) + cos * (y - 450) + 236
          const r = 28
          const cu = Math.min(Math.max(u, r), 750 - r)
          const cv = Math.min(Math.max(v, r), 472 - r)
          const on = u >= 0 && u <= 750 && v >= 0 && v <= 472 && Math.hypot(u - cu, v - cv) <= r
          const g = on ? 236 : 45 + rand() * 25
          data.set([g, g, g, 255], (y * W + x) * 4)
        }
      }
      const truth = [
        [0, 0],
        [750, 0],
        [750, 472],
        [0, 472],
      ].map(([u, v]) => ({ x: 600 + cos * (u! - 375) - sin * (v! - 236), y: 450 + sin * (u! - 375) + cos * (v! - 236) }))
      const { quad, found } = detectCard({ width: W, height: H, data })
      expect(found).toBe(true)
      for (const corner of quad) expect(Math.min(...truth.map((t) => Math.hypot(t.x - corner.x, t.y - corner.y)))).toBeLessThan(9)
    }
  })

  it("finds a card photographed sideways and turns it to landscape", () => {
    const card: Quad = [
      { x: 150, y: 80 },
      { x: 420, y: 100 },
      { x: 400, y: 520 },
      { x: 130, y: 500 },
    ]
    const { quad, found } = detectCard(photo(560, 640, card, 7))
    expect(found).toBe(true)
    const out = outputFor(quad)
    expect(out.width).toBeGreaterThan(out.height)
  })

  it("falls back to an inset rectangle when there's no card", () => {
    const flat: Pixels = { width: 300, height: 200, data: new Uint8ClampedArray(300 * 200 * 4).fill(128) }
    const { quad, found } = detectCard(flat)
    expect(found).toBe(false)
    expect(quad[0].x).toBeGreaterThan(0)
    expect(quad[2].x).toBeLessThan(300)
  })
})

describe("geometry", () => {
  it("orders corners clockwise from the top left", () => {
    const q = orderCorners([
      { x: 10, y: 90 },
      { x: 100, y: 5 },
      { x: 0, y: 0 },
      { x: 110, y: 95 },
    ])
    expect(q).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 5 },
      { x: 110, y: 95 },
      { x: 10, y: 90 },
    ])
  })

  it("keeps a hull's outer points only", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
    expect(hull).toHaveLength(4)
  })

  it("snaps a near-card shape to the card's proportions", () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 1600, y: 0 },
      { x: 1600, y: 980 },
      { x: 0, y: 980 },
    ]
    const out = outputFor(q)
    expect(out.width / out.height).toBeCloseTo(CARD_RATIO, 2)
    expect(measure(q).ratio).toBeCloseTo(1600 / 980, 3)
  })

  it("maps the output rectangle's corners onto the quad", () => {
    const q: Quad = [
      { x: 12, y: 30 },
      { x: 200, y: 10 },
      { x: 220, y: 150 },
      { x: 5, y: 140 },
    ]
    const H = homography(q, 160, 100)
    const map = (x: number, y: number) => {
      const z = H[6]! * x + H[7]! * y + H[8]!
      return { x: (H[0]! * x + H[1]! * y + H[2]!) / z, y: (H[3]! * x + H[4]! * y + H[5]!) / z }
    }
    expect(near(map(0, 0), q[0], 1e-6)).toBe(true)
    expect(near(map(160, 0), q[1], 1e-6)).toBe(true)
    expect(near(map(160, 100), q[2], 1e-6)).toBe(true)
    expect(near(map(0, 100), q[3], 1e-6)).toBe(true)
  })

  it("flattens the card: the output is the card's own light pixels", () => {
    const card: Quad = [
      { x: 140, y: 120 },
      { x: 640, y: 90 },
      { x: 670, y: 410 },
      { x: 160, y: 450 },
    ]
    const flat = warp(photo(800, 560, card), card, 320, 202)
    // Away from the edges, every pixel is card (light) or text (dark), never the table's mid grey.
    let table = 0
    for (let y = 8; y < 194; y++) {
      for (let x = 8; x < 312; x++) {
        const g = flat.data[(y * 320 + x) * 4]!
        if (g > 50 && g < 140) table++
      }
    }
    expect(table / (186 * 304)).toBeLessThan(0.02)
  })

  it("turns an image half a turn", () => {
    const img: Pixels = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]) }
    expect([...rotate180(img).data]).toEqual([5, 6, 7, 8, 1, 2, 3, 4])
  })
})
