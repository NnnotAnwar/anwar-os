"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, FolderOpen, Loader2Icon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { detectCard, type Pixels, type Quad } from "../lib/scan/geometry"
import type { DocumentSide } from "../schema"

// A live viewfinder like a scanner app's: the card's outline follows it in
// the camera picture, and once the card holds still for a moment the photo
// is taken by itself (or with the shutter). Frames are only looked at here;
// nothing is sent anywhere. Needs the camera allowed for this origin
// (Permissions-Policy in infra/edge/sites/anwar-os.caddy.tmpl).

/** The side the outline is found at, per frame: enough for a card, quick on a phone. */
const PREVIEW_SIDE = 360
/** How often a frame is checked. */
const EVERY_MS = 150
/** Frames in a row the card must hold still before the photo takes itself (~1 s). */
const STEADY_FRAMES = 7
/** "Still": no corner moved more than this share of the picture's diagonal since the last frame. */
const STILL = 0.012
/** The captured photo's longer side. */
const MAX_SIDE = 2400

export type Capture = { pixels: Pixels; quad: Quad; found: boolean; url: string }

export function cameraAvailable() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)
}

function grab(video: HTMLVideoElement, side: number) {
  const scale = Math.min(1, side / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { canvas, pixels: { width: img.width, height: img.height, data: img.data } as Pixels, scale }
}

const spread = (a: Quad, b: Quad, diag: number) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y))) / diag

export function ScanCamera({
  side,
  waitForTurn = false,
  onCapture,
  onSkip,
  onPickFiles,
}: {
  side: DocumentSide
  /**
   * The back, right after the front: the card is still there, front up, so
   * auto capture waits until it has been turned (it leaves the frame for a
   * moment or moves) instead of taking the front again.
   */
  waitForTurn?: boolean
  onCapture: (capture: Capture) => void
  /** Shown for the back: carry on with the front only. */
  onSkip?: () => void
  onPickFiles: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [size, setSize] = useState({ w: 16, h: 9 })
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<{ quad: Quad; found: boolean } | null>(null)
  const [steady, setSteady] = useState(0)
  const [auto, setAuto] = useState(true)
  const [flash, setFlash] = useState(false)
  const [armed, setArmed] = useState(!waitForTurn)
  const state = useRef({ last: null as Quad | null, first: null as Quad | null, steady: 0, auto: true, busy: false, armed: !waitForTurn })
  useEffect(() => {
    state.current.auto = auto
  }, [auto])

  // The rear camera while this is on screen; stopped the moment it isn't.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        const el = video.current
        if (!el) return
        el.srcObject = stream
        await el.play()
        // Phones report the size once frames flow, and again after a rotation.
        const measure = () => el.videoWidth && setSize({ w: el.videoWidth, h: el.videoHeight })
        el.addEventListener("resize", measure)
        measure()
        setReady(true)
      } catch (e) {
        const name = (e as { name?: string }).name
        setError(
          name === "NotAllowedError"
            ? "The camera isn't allowed for this site. Allow it in the browser's settings, or choose photos instead."
            : name === "NotFoundError"
              ? "No camera found. Choose photos instead."
              : "The camera didn't start. Choose photos instead.",
        )
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function capture() {
    const el = video.current
    if (!el || !el.videoWidth || state.current.busy) return
    state.current.busy = true
    setFlash(true)
    setTimeout(() => setFlash(false), 180)
    const { canvas, pixels } = grab(el, MAX_SIDE)
    const { quad, found } = detectCard(pixels)
    canvas.toBlob(
      (blob) => {
        const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/jpeg", 0.9)
        state.current = { ...state.current, last: null, steady: 0, busy: false }
        setSteady(0)
        onCapture({ pixels, quad, found, url })
      },
      "image/jpeg",
      0.9,
    )
  }
  const captureRef = useRef(capture)
  useEffect(() => {
    captureRef.current = capture
  })

  // Follow the card: a small frame every EVERY_MS, its outline, and how long it has held still.
  useEffect(() => {
    if (!ready) return
    const timer = setInterval(() => {
      const el = video.current
      if (!el || !el.videoWidth || state.current.busy || document.hidden) return
      const { pixels, scale } = grab(el, PREVIEW_SIDE)
      const { quad, found } = detectCard(pixels)
      const full = quad.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad
      const s = state.current
      const diag = Math.hypot(el.videoWidth, el.videoHeight)
      if (!s.armed) {
        // Turned: the card left the frame (a hand flipping it) or moved well away from where the front was.
        if (found) s.first ??= full
        if (!found || (s.first && spread(full, s.first, diag) > 0.06)) {
          s.armed = true
          setArmed(true)
        }
      }
      const still = found && s.last !== null && spread(full, s.last, diag) < STILL
      s.steady = still ? s.steady + 1 : 0
      s.last = found ? full : null
      setOutline({ quad: full, found })
      setSteady(s.steady)
      if (s.auto && s.armed && s.steady >= STEADY_FRAMES) captureRef.current()
    }, EVERY_MS)
    return () => clearInterval(timer)
  }, [ready])

  const { w, h } = size
  const holding = outline?.found && steady > 0 && armed
  const hint = !ready
    ? "Starting the camera…"
    : !armed
      ? "Turn the card over"
      : !outline?.found
      ? `Fit the ${side} of the card in the frame, on a darker surface`
      : holding
        ? auto
          ? "Hold still…"
          : "Got it: take the photo"
        : "Found the card"

  return (
    <div className="grid gap-3">
      <div
        className="relative mx-auto w-full overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: `${w} / ${h}`, maxHeight: "58dvh", maxWidth: `calc(58dvh * ${w / h})` }}
      >
        <video ref={video} playsInline muted autoPlay className="absolute inset-0 size-full object-fill" aria-label={`Camera: the ${side} of the card`} />
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-white/70">
            <Loader2Icon className="size-6 animate-spin" />
          </div>
        )}
        {outline && ready && (
          <svg viewBox={`0 0 ${w} ${h}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
            <polygon
              points={outline.quad.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={outline.found ? "rgb(99 102 241 / 0.18)" : "none"}
              stroke={outline.found ? (holding ? "rgb(52 211 153)" : "white") : "rgb(255 255 255 / 0.35)"}
              strokeWidth={Math.max(w, h) * 0.006}
              strokeDasharray={outline.found ? undefined : `${w * 0.02} ${w * 0.015}`}
              strokeLinejoin="round"
            />
          </svg>
        )}
        <div className={cn("pointer-events-none absolute inset-0 bg-white transition-opacity duration-150", flash ? "opacity-70" : "opacity-0")} />
        <p className="text-caption absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 text-center text-white" aria-live="polite">
          {hint}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          aria-label={`Take the photo of the ${side}`}
          className="press relative grid size-16 place-items-center rounded-full bg-white/90 ring-4 ring-accent-500/60 outline-none disabled:opacity-40 focus-visible:ring-ring/80"
        >
          <span className="size-12 rounded-full bg-accent-500" />
          {auto && holding && (
            <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(52 211 153)" strokeWidth="3" strokeDasharray={`${(Math.min(steady, STEADY_FRAMES) / STEADY_FRAMES) * 100.5} 100.5`} />
            </svg>
          )}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          onClick={() => setAuto((a) => !a)}
          className={cn(
            "text-caption h-11 rounded-full px-4 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:px-3",
            auto ? "bg-accent-500/15 text-text-accent" : "bg-track text-muted-foreground",
          )}
        >
          <Camera className="mr-1 inline size-3.5 align-[-2px]" />
          Auto capture {auto ? "on" : "off"}
        </button>
        {onSkip && (
          <Button type="button" variant="ghost" className="h-11 md:h-8" onClick={onSkip}>
            No back side
          </Button>
        )}
        <Button type="button" variant="ghost" className="h-11 md:h-8" onClick={onPickFiles}>
          <FolderOpen />
          Choose photos instead
        </Button>
      </div>
    </div>
  )
}
