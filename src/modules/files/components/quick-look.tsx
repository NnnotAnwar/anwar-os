"use client"

import { useEffect } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Download, ExternalLink } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { itemHref, rawHref } from "../lib/links"
import { formatBytes, previewKind } from "../lib/validation"
import type { FileItem } from "../schema"
import { ItemIcon } from "./file-type-icon"

/** Files Quick Look can show, in list order. */
export function previewable<T extends { kind: string }>(rows: T[]): (T & FileItem)[] {
  return rows.filter((r): r is T & FileItem => r.kind === "file" && previewKind((r as unknown as FileItem).mime) !== null)
}

/**
 * Space on a file (or "Quick look" in its menu) previews it in place, like
 * Finder. ← / → page through the folder's images and PDFs; Esc closes.
 */
export function QuickLook({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: FileItem[]
  index: number | null
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const file = index === null ? null : files[index]
  const open = file !== undefined && file !== null

  useEffect(() => {
    if (!open || index === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" && index! < files.length - 1) {
        e.preventDefault()
        onIndex(index! + 1)
      } else if (e.key === "ArrowLeft" && index! > 0) {
        e.preventDefault()
        onIndex(index! - 1)
      } else if (e.key === " " && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
        e.preventDefault()
        onClose()
      }
    }
    // Capture: the dialog keeps arrow keys from bubbling past it.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, index, files.length, onIndex, onClose])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass glass-menu grid max-h-[calc(100svh-2rem)] gap-3 p-3 sm:max-w-3xl">
        {file && (
          <>
            <div className="flex min-w-0 items-center gap-2 pr-8">
              <ItemIcon item={file} className="size-7" />
              <div className="grid min-w-0">
                <DialogTitle className="text-body-strong truncate">{file.name}</DialogTitle>
                <DialogDescription className="text-caption text-muted-foreground tabular-nums">
                  {formatBytes(file.size)}
                  {files.length > 1 && ` · ${index! + 1} of ${files.length}`}
                </DialogDescription>
              </div>
            </div>
            <div className="relative grid min-h-64 place-items-center overflow-hidden rounded-lg bg-muted">
              {previewKind(file.mime) === "image" ? (
                // A presigned redirect; next/image can't optimise private, short-lived URLs.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={file.id}
                  src={rawHref(file.id, "inline")}
                  alt={file.description || file.name}
                  className="max-h-[65svh] w-auto animate-in object-contain duration-200 fade-in-0 motion-reduce:animate-none"
                />
              ) : (
                <iframe key={file.id} src={rawHref(file.id, "inline")} title={`Preview of ${file.name}`} className="h-[65svh] w-full bg-white" />
              )}
              {files.length > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="Previous file"
                    disabled={index === 0}
                    onClick={() => onIndex(index! - 1)}
                    className="glass absolute top-1/2 left-2 -translate-y-1/2 rounded-full disabled:opacity-0"
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="Next file"
                    disabled={index === files.length - 1}
                    onClick={() => onIndex(index! + 1)}
                    className="glass absolute top-1/2 right-2 -translate-y-1/2 rounded-full disabled:opacity-0"
                  >
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-caption mr-auto hidden items-center gap-1 text-muted-foreground pointer-fine:flex">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd> browse · <Kbd>Space</Kbd> close
              </p>
              <a href={rawHref(file.id, "download")} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                <Download />
                Download
              </a>
              <Link href={itemHref(file)} className={buttonVariants({ size: "lg" })}>
                <ExternalLink />
                Details
              </Link>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
