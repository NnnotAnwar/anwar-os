"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { ArrowsLeftRight, Crop, Loader2Icon, Plus, Scan, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { rawHref } from "@/modules/files/lib/links"
import { detectCard, outputFor, rotate180, warp, type Pixels, type Point, type Quad } from "../lib/scan/geometry"
import { readPhoto, releaseOcr, type OcrProgress, type PhotoText } from "../lib/scan/ocr"
import { readCard, type ScanReading } from "../lib/scan/read"
import { kindLabels, type AttachedFile, type DocumentSide } from "../schema"
import { cameraAvailable, ScanCamera, type Capture } from "./scan-camera"
import { uploadScan } from "./upload-scan"

// The document scanner: photos of a card's sides are straightened (corners
// found by lib/scan/geometry.ts, adjustable by dragging), read on the device
// (lib/scan/ocr.ts + read.ts) and uploaded as flat card images. Nothing leaves
// the browser except the finished photos, into the owner's own Files.

/** Enough pixels for sharp text on the card; more only costs memory on a phone. */
const MAX_SIDE = 2400

type Shot = { id: string; name: string; url: string; revoke: boolean; pixels: Pixels; quad: Quad; found: boolean }

/** What a scan gives back: the uploaded photos with their sides, and what it read. */
export type ScanResult = { files: AttachedFile[]; reading: ScanReading; replaced: AttachedFile | null }

/** What the scanner starts with: the camera, new photos, or an attached photo to straighten again. */
export type ScanStart = { camera: true } | { files: File[] } | { replace: AttachedFile }

function shotFrom(capture: Capture, name: string): Shot {
  return { id: crypto.randomUUID(), name, url: capture.url, revoke: capture.url.startsWith("blob:"), pixels: capture.pixels, quad: capture.quad, found: capture.found }
}

async function loadShot(blob: Blob, name: string, url: string, revoke: boolean): Promise<Shot> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" })
  } catch {
    throw new Error(`${name} couldn't be opened here. Take the photo as a JPEG or PNG and try again.`)
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = { width: image.width, height: image.height, data: image.data }
  const { quad, found } = detectCard(pixels)
  return { id: crypto.randomUUID(), name, url, revoke, pixels, quad, found }
}

function toJpeg(img: Pixels): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo couldn't be saved."))), "image/jpeg", 0.9))
}

const whole = (p: Pixels): Quad => [
  { x: 0, y: 0 },
  { x: p.width, y: 0 },
  { x: p.width, y: p.height },
  { x: 0, y: p.height },
]

/** Sides by position: the first photo is the front, the second the back. */
const sideAt = (i: number): DocumentSide => (i === 0 ? "front" : "back")
const sideLabel: Record<DocumentSide, string> = { front: "Front", back: "Back" }

export function ScanDialog({
  start,
  onClose,
  onDone,
}: {
  start: ScanStart | null
  onClose: () => void
  onDone: (result: ScanResult) => void
}) {
  const [shots, setShots] = useState<Shot[]>([])
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const more = useRef<HTMLInputElement>(null)
  const replacing = start && "replace" in start ? start.replace : null
  const [mode, setMode] = useState<"camera" | "review">("review")

  // A new start: load its photos (an attached one comes from Files, through the session).
  const [loadedFor, setLoadedFor] = useState<ScanStart | null>(null)
  if (start !== loadedFor) {
    setLoadedFor(start)
    setShots([])
    setCurrent(0)
    setError(null)
    setBusy(null)
    setMode(start && "camera" in start ? "camera" : "review")
    if (start && !("camera" in start)) setLoading(true)
  }
  useEffect(() => {
    if (!start || "camera" in start) return
    let cancelled = false
    ;(async () => {
      try {
        const loaded =
          "replace" in start
            ? [
                await fetch(rawHref(start.replace.id, "inline"))
                  .then((r) => {
                    if (!r.ok) throw new Error("The photo couldn't be loaded from Files. Try again.")
                    return r.blob()
                  })
                  .then((b) => loadShot(b, start.replace.name, URL.createObjectURL(b), true)),
              ]
            : await Promise.all(start.files.slice(0, 2).map((f) => loadShot(f, f.name, URL.createObjectURL(f), true)))
        if (!cancelled) setShots(loaded)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "The photo couldn't be opened.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [start])

  // Object URLs and the OCR worker go when the scanner closes.
  const shotsRef = useRef(shots)
  useEffect(() => {
    shotsRef.current = shots
  })
  useEffect(() => {
    if (start) return
    for (const s of shotsRef.current) if (s.revoke) URL.revokeObjectURL(s.url)
    void releaseOcr()
  }, [start])

  async function addFiles(files: File[]) {
    setError(null)
    setLoading(true)
    try {
      const added = await Promise.all(files.slice(0, 2 - shots.length).map((f) => loadShot(f, f.name, URL.createObjectURL(f), true)))
      setShots((list) => [...list, ...added].slice(0, 2))
      setCurrent(Math.min(1, shots.length))
      setMode("review")
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo couldn't be opened.")
    } finally {
      setLoading(false)
    }
  }

  const shot = shots[current]
  const camera = start !== null && "camera" in start

  function captured(capture: Capture) {
    const next = [...shots, shotFrom(capture, shots.length ? "Back" : "Front")].slice(0, 2)
    setShots(next)
    setCurrent(next.length - 1)
    // After the front, the back; after both, the review.
    if (next.length >= 2) setMode("review")
  }
  const setQuad = (quad: Quad) => setShots((list) => list.map((s, i) => (i === current ? { ...s, quad, found: true } : s)))

  async function finish() {
    if (!shots.length) return
    setError(null)
    try {
      const flats: Pixels[] = []
      const texts: PhotoText[] = []
      for (const [i, s] of shots.entries()) {
        const side = replacing?.side ? sideLabel[replacing.side].toLowerCase() : sideAt(i)
        setBusy(`Straightening the ${side}…`)
        setProgress(null)
        await new Promise((r) => setTimeout(r, 0))
        const out = outputFor(s.quad)
        let flat = warp(s.pixels, out.quad, out.width, out.height)
        let text: PhotoText = { text: "", mrzText: "", confidence: 0, rotated: false }
        try {
          text = await readPhoto(flat, (p: OcrProgress) => {
            setBusy(p.stage === "loading" ? "Loading the reader (once, about 4 MB)…" : `Reading the ${side}…`)
            setProgress(p.progress)
          })
        } catch (e) {
          console.warn("documents: OCR failed", e)
        }
        if (text.rotated) flat = rotate180(flat)
        flats.push(flat)
        texts.push(text)
      }
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
      const reading = readCard(texts, today)
      // The MRZ is on a card's back, and on a passport's data page (its front).
      const sides = flats.map((_, i) => sideAt(i))
      if (flats.length === 2 && reading.mrzPhoto !== null) {
        const mrzSide: DocumentSide = reading.kind === "passport" ? "front" : "back"
        sides[reading.mrzPhoto] = mrzSide
        sides[1 - reading.mrzPhoto] = mrzSide === "front" ? "back" : "front"
      }
      if (replacing) sides[0] = replacing.side ?? "front"
      const title = reading.kind ? kindLabels[reading.kind].split(" /")[0] : "Document"
      const files: AttachedFile[] = []
      for (const [i, flat] of flats.entries()) {
        setBusy(`Saving the ${sides[i]}…`)
        setProgress(null)
        const blob = await toJpeg(flat)
        const file = new File([blob], `${title} — ${sides[i]}.jpg`, { type: "image/jpeg" })
        const uploaded = await uploadScan(file, (loaded) => setProgress(loaded / blob.size))
        files.push({ ...uploaded, side: sides[i] })
      }
      onDone({ files, reading, replaced: replacing })
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan didn't finish. Try again.")
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <Dialog open={start !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scan className="size-4 text-text-accent" />
            {replacing ? "Straighten the photo" : "Scan the document"}
          </DialogTitle>
          <DialogDescription>
            {busy
              ? "This runs on your device; only the finished photos are saved, to your Files."
              : mode === "camera"
                ? `Hold the ${shots.length ? "back" : "front"} of the card in the frame: it's found and photographed by itself.`
                : "Check that the corners sit on the card's edges, or drag them there. Then the photos are straightened and the dates read on your device."}
          </DialogDescription>
        </DialogHeader>

        {mode === "camera" && !busy ? (
          <ScanCamera
            key={shots.length}
            side={shots.length ? "back" : "front"}
            waitForTurn={shots.length > 0}
            onCapture={captured}
            onSkip={shots.length ? () => setMode("review") : undefined}
            onPickFiles={() => more.current?.click()}
          />
        ) : busy ? (
          <div className="grid place-items-center gap-3 py-10" aria-live="polite">
            <Loader2Icon className="size-6 animate-spin text-text-accent" />
            <p className="text-body">{busy}</p>
            {progress !== null && (
              <div className="h-1 w-48 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
        ) : loading && !shot ? (
          <div className="grid place-items-center py-10">
            <Loader2Icon className="size-6 animate-spin text-text-accent" />
          </div>
        ) : shot ? (
          <>
            {!replacing && (
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Photos">
                {shots.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === current}
                    onClick={() => setCurrent(i)}
                    className={cn(
                      "text-caption h-11 rounded-full px-4 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:px-3",
                      i === current ? "bg-accent-500 text-white" : "bg-track text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {sideLabel[sideAt(i)]}
                  </button>
                ))}
                {shots.length < 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 md:h-8"
                    onClick={() => (camera && cameraAvailable() ? setMode("camera") : more.current?.click())}
                    disabled={loading}
                  >
                    <Plus />
                    Add the back
                  </Button>
                )}
                {shots.length === 2 && (
                  <Button type="button" variant="ghost" className="h-11 md:h-8" onClick={() => setShots(([a, b]) => [b!, a!])}>
                    <ArrowsLeftRight />
                    Swap sides
                  </Button>
                )}
              </div>
            )}
            <CornerEditor key={shot.id} shot={shot} onChange={setQuad} />
            <p className="text-caption text-muted-foreground">
              {shot.found ? "Found the card. Drag a corner if it's off." : "Couldn't find the card's edges: drag the four corners onto them."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={() => setQuad(whole(shot.pixels))}>
                <Crop />
                Use the whole photo
              </Button>
              {!replacing && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 md:h-9"
                  onClick={() => {
                    setShots((list) => list.filter((s) => s.id !== shot.id))
                    setCurrent(0)
                  }}
                >
                  <Trash2 />
                  Remove this photo
                </Button>
              )}
            </div>
          </>
        ) : (
          !error && <p className="text-meta py-6 text-center text-muted-foreground">No photo yet.</p>
        )}

        <input
          ref={more}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ""
            if (files.length) void addFiles(files)
          }}
        />
        {error && (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}
        {!busy && mode === "review" && (
          <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
            <Button type="button" size="lg" className="h-11 md:h-9" onClick={() => void finish()} disabled={!shots.length || loading}>
              <Scan />
              {replacing ? "Straighten and save" : shots.length > 1 ? "Straighten and read both" : "Straighten and read"}
            </Button>
            <Button type="button" variant="ghost" size="lg" className="h-11 md:h-9" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The photo with the card's outline and four corners to drag (or move with the arrow keys). */
function CornerEditor({ shot, onChange }: { shot: Shot; onChange: (quad: Quad) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)
  const { width: w, height: h } = shot.pixels
  const r = Math.max(w, h) * 0.022

  function toImage(e: PointerEvent): Point | null {
    const el = svg.current
    const m = el?.getScreenCTM()
    if (!el || !m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) }
  }
  function move(i: number, p: Point) {
    const next = [...shot.quad] as Quad
    next[i] = p
    onChange(next)
  }
  function onKey(i: number, e: KeyboardEvent) {
    const step = Math.max(w, h) * (e.shiftKey ? 0.02 : 0.005)
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const p = shot.quad[i]!
    move(i, { x: Math.max(0, Math.min(w, p.x + d[0]!)), y: Math.max(0, Math.min(h, p.y + d[1]!)) })
  }

  const labels = ["Top left", "Top right", "Bottom right", "Bottom left"]
  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${w} / ${h}`, maxHeight: "55dvh", maxWidth: `calc(55dvh * ${w / h})` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of the photo being scanned */}
      <img src={shot.url} alt="" draggable={false} className="absolute inset-0 size-full object-fill select-none" />
      <svg
        ref={svg}
        viewBox={`0 0 ${w} ${h}`}
        className="absolute inset-0 size-full touch-none"
        onPointerMove={(e) => {
          if (dragging.current === null) return
          const p = toImage(e)
          if (p) move(dragging.current, p)
        }}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
      >
        <path
          d={`M0 0H${w}V${h}H0Z M${shot.quad.map((p) => `${p.x} ${p.y}`).join(" L")}Z`}
          fill="rgb(0 0 0 / 0.45)"
          fillRule="evenodd"
        />
        <polygon points={shot.quad.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="white" strokeWidth={r * 0.18} />
        {shot.quad.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={r}
            fill="rgb(99 102 241 / 0.85)"
            stroke="white"
            strokeWidth={r * 0.18}
            tabIndex={0}
            role="slider"
            aria-label={`${labels[i]} corner`}
            aria-valuetext={`${Math.round((p.x / w) * 100)}% across, ${Math.round((p.y / h) * 100)}% down`}
            className="cursor-grab outline-none focus-visible:stroke-[6]"
            onKeyDown={(e) => onKey(i, e)}
            onPointerDown={(e) => {
              e.preventDefault()
              svg.current?.setPointerCapture(e.pointerId)
              dragging.current = i
            }}
          />
        ))}
      </svg>
    </div>
  )
}
