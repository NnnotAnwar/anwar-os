"use client"

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react"
import Link from "next/link"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ArrowsClockwise, Camera, CornersOut, XIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { rawHref } from "@/modules/files/lib/links"
import { formatDate } from "../lib/dates"
import { cardSides } from "../lib/sides"
import { kindLabels, type AttachedFile, type DocumentDetail, type DocumentKind, type DocumentSide } from "../schema"
import { KindIcon } from "./bits"

// The document as a card you can turn over, like the ones in a bank or ID
// wallet app: the photos marked Front and Back, a tap (or a sideways swipe)
// flips it, Full screen shows the side whole for a counter or a border.

/** Width / height: a passport's data page (ID-3), every other kind a bank-card sized ID-1. */
const ratio = (kind: DocumentKind) => (kind === "passport" ? 125 / 88 : 85.6 / 54)

/** A sideways drag at least this long (px) turns the card. */
const SWIPE = 40

const sideLabel: Record<DocumentSide, string> = { front: "Front", back: "Back" }

export function DocumentCard({ document }: { document: DocumentDetail }) {
  const { front, back } = cardSides(document.files)
  const [flipped, setFlipped] = useState(false)
  const [viewing, setViewing] = useState<DocumentSide | null>(null)
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const canFlip = Boolean(front && back)
  const shown: DocumentSide = flipped ? "back" : "front"
  // Next keeps a page you leave mounted but hidden: don't come back to it full screen.
  useEffect(() => () => setViewing(null), [])

  function onPointerDown(e: PointerEvent) {
    swipe.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  function onPointerUp(e: PointerEvent) {
    const start = swipe.current
    if (!start) return
    const dx = e.clientX - start.x
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
      start.moved = true
      if (canFlip) setFlipped((f) => !f)
    }
  }
  function onClick() {
    // The click that ends a swipe already turned the card.
    if (swipe.current?.moved) return void (swipe.current = null)
    if (canFlip) setFlipped((f) => !f)
    else if (front || back) setViewing(front ? "front" : "back")
  }

  const photos = Boolean(front || back)
  return (
    <section aria-label="The card" className="grid gap-3">
      <div className="mx-auto w-full max-w-md [perspective:1400px]">
        <button
          type="button"
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          disabled={!photos}
          aria-label={
            canFlip ? `${document.name}, ${shown} side. Turn over` : photos ? `${document.name}: show full screen` : undefined
          }
          className="press group relative block w-full touch-pan-y rounded-2xl outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
          style={{ aspectRatio: ratio(document.kind) }}
        >
          <div
            className={cn(
              "absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none",
              flipped && "[transform:rotateY(180deg)]",
            )}
          >
            <Face>{front ? <Photo file={front} alt={`Front of ${document.name}`} /> : <MadeFace document={document} />}</Face>
            {back && (
              <Face className="[transform:rotateY(180deg)]">
                <Photo file={back} alt={`Back of ${document.name}`} />
              </Face>
            )}
          </div>
        </button>
      </div>

      {photos ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {canFlip && (
            <>
              <span className="text-caption basis-full text-center text-muted-foreground sm:basis-auto" aria-live="polite">
                {sideLabel[shown]} · tap or swipe to turn over
              </span>
              <Button type="button" variant="ghost" size="lg" className="h-11 md:h-9" onClick={() => setFlipped((f) => !f)}>
                <ArrowsClockwise />
                Turn over
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" size="lg" className="h-11 md:h-9" onClick={() => setViewing(canFlip ? shown : front ? "front" : "back")}>
            <CornersOut />
            Full screen
          </Button>
        </div>
      ) : (
        <p className="text-caption text-center text-muted-foreground">
          <Link href={`/app/documents/${document.id}/edit`} className="text-text-accent underline-offset-4 hover:underline">
            Add photos of both sides
          </Link>{" "}
          to have the card here, front and back.
        </p>
      )}
      {photos && !canFlip && (
        <p className="text-caption -mt-1 text-center text-muted-foreground">
          <Link href={`/app/documents/${document.id}/edit`} className="text-text-accent underline-offset-4 hover:underline">
            Add the {front ? "back" : "front"}
          </Link>{" "}
          to turn the card over.
        </p>
      )}

      <FullScreen
        document={document}
        sides={{ front, back }}
        side={viewing}
        onSide={(side) => {
          setViewing(side)
          if (side) setFlipped(side === "back")
        }}
      />
    </section>
  )
}

function Face({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden rounded-2xl bg-muted shadow-[var(--shadow-glass-lg)] ring-1 ring-foreground/10 [backface-visibility:hidden] [-webkit-backface-visibility:hidden]",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A side's photo, filling the card; one taken the other way round (portrait) is shown whole. */
function Photo({ file, alt }: { file: AttachedFile; alt: string }) {
  const [portrait, setPortrait] = useState(false)
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a presigned redirect, not an optimizable asset
    <img
      src={rawHref(file.id, "inline")}
      alt={alt}
      draggable={false}
      onLoad={(e) => setPortrait(e.currentTarget.naturalHeight > e.currentTarget.naturalWidth)}
      className={cn("size-full", portrait ? "bg-black object-contain" : "object-cover")}
    />
  )
}

/** The front when there's no photo of it: the document's own details, card-shaped. */
function MadeFace({ document }: { document: DocumentDetail }) {
  return (
    <div className="flex size-full flex-col justify-between bg-accent-500/10 p-4 text-left sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-eyebrow text-text-accent">{kindLabels[document.kind]}</span>
        <KindIcon kind={document.kind} tone={document.status.tone} className="size-9" />
      </div>
      <div className="grid gap-1">
        <span className="text-card-title line-clamp-2 break-words">{document.name}</span>
        <span className="text-caption text-muted-foreground tabular-nums">
          {document.status.tone === "expired" ? "Was valid until" : "Valid until"} {formatDate(document.expiresOn)}
        </span>
      </div>
      <span className="text-caption flex items-center gap-1.5 text-muted-foreground">
        <Camera className="size-3.5" />
        No photo yet
      </span>
    </div>
  )
}

/** One side, as large as the screen allows, on black; the other side a tap away. */
function FullScreen({
  document,
  sides,
  side,
  onSide,
}: {
  document: DocumentDetail
  sides: { front: AttachedFile | null; back: AttachedFile | null }
  side: DocumentSide | null
  onSide: (side: DocumentSide | null) => void
}) {
  const file = side ? sides[side] : null
  const both = Boolean(sides.front && sides.back)
  return (
    <DialogPrimitive.Root open={Boolean(file)} onOpenChange={(open) => !open && onSide(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex flex-col text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          onKeyDown={(e) => {
            if (both && (e.key === "ArrowLeft" || e.key === "ArrowRight")) onSide(side === "front" ? "back" : "front")
          }}
        >
          <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <DialogPrimitive.Title className="text-body-strong min-w-0 flex-1 truncate">
              {document.name}
              {side && <span className="font-normal text-white/60"> · {sideLabel[side]}</span>}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon" className="size-11 text-white hover:bg-white/10 hover:text-white" />}
              aria-label="Close"
            >
              <XIcon />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            {file && (
              // eslint-disable-next-line @next/next/no-img-element -- a presigned redirect, not an optimizable asset
              <img
                key={file.id}
                src={rawHref(file.id, "inline")}
                alt={`${side === "back" ? "Back" : "Front"} of ${document.name}`}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            )}
          </div>
          <div className="flex items-center justify-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {both && (
              <span role="group" aria-label="Side" className="flex rounded-full bg-white/10 p-1">
                {(["front", "back"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={side === s}
                    onClick={() => onSide(s)}
                    className={cn(
                      "text-small h-10 rounded-full px-5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-white/50",
                      side === s ? "bg-white text-black" : "text-white/70 hover:text-white",
                    )}
                  >
                    {sideLabel[s]}
                  </button>
                ))}
              </span>
            )}
            {file && (
              <Link
                href={`/app/files/file/${file.id}`}
                className="text-caption rounded px-2 py-3 text-white/60 underline-offset-4 outline-none hover:text-white hover:underline focus-visible:ring-3 focus-visible:ring-white/50"
              >
                Open in Files
              </Link>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
