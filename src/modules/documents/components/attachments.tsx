"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Camera, Check, Crop, FolderOpen, Search, TriangleAlertIcon, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ItemIcon } from "@/modules/files/components/file-type-icon"
import { rawHref } from "@/modules/files/lib/links"
import { formatBytes } from "@/modules/files/lib/validation"
import { attach, markSide } from "../lib/sides"
import { isCardPhoto, MAX_FILES, type AttachedFile, type DocumentSide } from "../schema"
import { searchFiles } from "../server-actions"
import type { PickableFile } from "../scans"
import { uploadScan } from "./upload-scan"

type Upload = { id: string; name: string; loaded: number; size: number; error?: string }

/**
 * The files attached to a document: upload a scan (it lands in Files →
 * Documents through the files module's own upload) or pick existing Files
 * items. Photos can be the card's front or back (the first two take those
 * sides by themselves). Changes apply when the form is saved.
 */
export function Attachments({
  files,
  onChange,
  onBusy,
  onStraighten,
  label = "Scans and files",
}: {
  files: AttachedFile[]
  onChange: (update: (files: AttachedFile[]) => AttachedFile[]) => void
  onBusy?: (busy: boolean) => void
  /** Opens the scanner on an attached photo (crop it to the card, read it again). */
  onStraighten?: (file: AttachedFile) => void
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [picking, setPicking] = useState(false)
  const busy = uploads.some((u) => !u.error)
  const full = files.length >= MAX_FILES

  useEffect(() => onBusy?.(busy), [busy, onBusy])

  async function upload(file: File) {
    const id = crypto.randomUUID()
    const patch = (next: Partial<Upload>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...next } : u)))
    setUploads((list) => [...list, { id, name: file.name, loaded: 0, size: file.size }])
    try {
      const uploaded = await uploadScan(file, (loaded) => patch({ loaded }))
      onChange((list) => attach(list, uploaded))
      setUploads((list) => list.filter((u) => u.id !== id))
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : "The upload failed." })
    }
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-small mb-1.5 text-muted-foreground">{label}</legend>
      {files.length > 0 && (
        <ul className="grid gap-1" aria-label="Attached files">
          {files.map((file) => (
            <li key={file.id} className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg bg-field px-2 py-1.5">
              {isCardPhoto(file.mime) ? (
                // eslint-disable-next-line @next/next/no-img-element -- a presigned redirect, not an optimizable asset
                <img src={rawHref(file.id, "inline")} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-muted object-cover" />
              ) : (
                <ItemIcon item={{ kind: "file", mime: file.mime }} />
              )}
              <span className="grid min-w-0 flex-1">
                <span className="text-body truncate">{file.name}</span>
                <span className="text-caption text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>
              </span>
              {isCardPhoto(file.mime) && (
                <SidePicker
                  name={file.name}
                  side={file.side ?? null}
                  onPick={(side) => onChange((list) => markSide(list, file.id, side))}
                />
              )}
              {onStraighten && isCardPhoto(file.mime) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground md:size-9"
                  onClick={() => onStraighten(file)}
                  aria-label={`Straighten ${file.name}`}
                  title="Straighten and read"
                >
                  <Crop />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-muted-foreground md:size-9"
                onClick={() => onChange((list) => list.filter((f) => f.id !== file.id))}
                aria-label={`Detach ${file.name}`}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {uploads.length > 0 && (
        <ul className="grid gap-1.5" aria-live="polite" aria-label="Uploads">
          {uploads.map((u) => {
            const pct = u.size ? Math.round((u.loaded / u.size) * 100) : 100
            return (
              <li key={u.id} className="grid gap-1 rounded-lg bg-field px-3 py-2">
                <div className="flex items-center gap-2">
                  {u.error && <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />}
                  <span className="text-meta min-w-0 flex-1 truncate">{u.name}</span>
                  {u.error ? (
                    <button
                      type="button"
                      onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                      className="text-caption rounded px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Dismiss
                    </button>
                  ) : (
                    <span className="text-caption text-muted-foreground tabular-nums">{pct < 100 ? `${pct}%` : "Saving…"}</span>
                  )}
                </div>
                {u.error ? (
                  <p className="text-caption text-destructive">{u.error}</p>
                ) : (
                  <div
                    className="h-1 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`Uploading ${u.name}`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []).slice(0, MAX_FILES - files.length)
            e.target.value = ""
            for (const file of chosen) void upload(file)
          }}
        />
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => input.current?.click()} disabled={full}>
          <Camera />
          Upload a scan
        </Button>
        <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={() => setPicking(true)} disabled={full}>
          <FolderOpen />
          Choose from Files
        </Button>
      </div>
      <p className="text-caption text-muted-foreground">
        A photo or PDF. Photos marked Front and Back make the card you can flip on the document&apos;s page. Scans are saved privately
        in Files → Documents; only you can open them.
      </p>
      <FilePicker
        open={picking}
        onOpenChange={setPicking}
        selected={files}
        onToggle={(file) =>
          onChange((list) =>
            list.some((f) => f.id === file.id) ? list.filter((f) => f.id !== file.id) : list.length >= MAX_FILES ? list : attach(list, file),
          )
        }
      />
    </fieldset>
  )
}

const SIDES: { side: DocumentSide; label: string }[] = [
  { side: "front", label: "Front" },
  { side: "back", label: "Back" },
]

/** Front / Back for one photo: tap a side to give it this photo, tap it again to unmark. */
function SidePicker({ name, side, onPick }: { name: string; side: DocumentSide | null; onPick: (side: DocumentSide | null) => void }) {
  return (
    <span role="group" aria-label={`Card side of ${name}`} className="flex shrink-0 rounded-full bg-track p-0.5 max-sm:order-last max-sm:ml-[3.125rem] max-sm:basis-[calc(100%-3.125rem)] max-sm:*:flex-1">
      {SIDES.map((option) => {
        const on = side === option.side
        return (
          <button
            key={option.side}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? null : option.side)}
            className={cn(
              "text-caption h-9 rounded-full px-3 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-7 md:px-2.5",
              on ? "bg-accent-500 text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </span>
  )
}

function FilePicker({
  open,
  onOpenChange,
  selected,
  onToggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: AttachedFile[]
  onToggle: (file: AttachedFile) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PickableFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const chosen = new Set(selected.map((f) => f.id))

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(
      () =>
        start(async () => {
          const result = await searchFiles({ query })
          if (!result.ok) return setError(result.error)
          setError(null)
          setResults(result.value)
        }),
      query ? 250 : 0,
    )
    return () => clearTimeout(timer)
  }, [open, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass glass-menu grid max-h-[85svh] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose from Files</DialogTitle>
          <DialogDescription>Tap files to attach them. They stay where they are in Files.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="document-file-search" className="sr-only">
            Search files
          </label>
          <Input
            id="document-file-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or tag"
            autoComplete="off"
            className="h-11 pl-9 md:h-9"
          />
        </div>
        <div className="min-h-0 overflow-y-auto" aria-busy={pending}>
          {error ? (
            <p className="text-meta text-destructive">{error}</p>
          ) : results === null ? (
            <p className="text-meta text-muted-foreground">Loading…</p>
          ) : results.length === 0 ? (
            <p className="text-meta text-muted-foreground">{query ? "No files match." : "No files yet. Upload a scan instead."}</p>
          ) : (
            <ul className="grid gap-0.5">
              {!query && <li className="text-eyebrow px-2 pb-1 text-muted-foreground">Recent</li>}
              {results.map((file) => {
                const on = chosen.has(file.id)
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onToggle(file)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50",
                        on && "bg-accent-500/10",
                      )}
                    >
                      <ItemIcon item={{ kind: "file", mime: file.mime }} />
                      <span className="grid min-w-0 flex-1">
                        <span className="text-body truncate">{file.name}</span>
                        <span className="text-caption truncate text-muted-foreground">
                          {[file.folderName, formatBytes(file.size)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {on && <Check className="size-4 shrink-0 text-text-accent" aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => onOpenChange(false)} className="h-11 md:h-9">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
