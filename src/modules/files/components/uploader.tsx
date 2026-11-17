"use client"

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { Check, CloudUpload, TriangleAlertIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { checkUpload, formatBytes } from "../lib/validation"
import { confirmUpload, finishUploads, prepareUpload } from "../server-actions"

type Status = "queued" | "uploading" | "saving" | "done" | "error"
export type Upload = { id: string; name: string; size: number; loaded: number; status: Status; error?: string }

const CONCURRENCY = 3

/** PUT straight to object storage with progress events (fetch has none for uploads). */
function putWithProgress(url: string, file: File, mime: string, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", mime)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the upload (${xhr.status}).`)))
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."))
    xhr.send(file)
  })
}

type Setter = (update: (list: Upload[]) => Upload[]) => void

/**
 * Upload queue: each file is checked locally, gets a presigned URL from the
 * server, goes straight to storage, then the server confirms and records it.
 * Plain closure state (not React state) so concurrent workers share it.
 */
function createQueue(folderId: string | null, setUploads: Setter) {
  const queue: { id: string; file: File }[] = []
  let active = 0
  let done = 0
  let failed = 0
  const patch = (id: string, next: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...next } : u)))

  async function work(id: string, file: File) {
    try {
      const prepared = await prepareUpload({ name: file.name, size: file.size, type: file.type, folderId })
      if (!prepared.ok) throw new Error(prepared.error)
      patch(id, { status: "uploading" })
      await putWithProgress(prepared.value.url, file, prepared.value.mime, (loaded) => patch(id, { loaded }))
      patch(id, { status: "saving", loaded: file.size })
      const confirmed = await confirmUpload({ key: prepared.value.key, name: file.name, folderId })
      if (!confirmed.ok) throw new Error(confirmed.error)
      patch(id, { status: "done" })
      done++
    } catch (error) {
      patch(id, { status: "error", error: error instanceof Error ? error.message : "Upload failed." })
      failed++
    }
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const { id, file } = queue.shift()!
      active++
      void work(id, file).then(async () => {
        active--
        if (active > 0 || queue.length > 0) return pump()
        const batch = { done, failed }
        done = 0
        failed = 0
        if (batch.done) {
          await finishUploads()
          toast.success(batch.done === 1 ? "File uploaded" : `${batch.done} files uploaded`)
        }
        if (batch.failed && !batch.done) toast.error(batch.failed === 1 ? "The upload failed" : `${batch.failed} uploads failed`)
      })
    }
  }

  return {
    add(files: FileList | File[]) {
      const next: Upload[] = []
      for (const file of Array.from(files)) {
        const id = crypto.randomUUID()
        const check = checkUpload(file)
        if (!check.ok) {
          next.push({ id, name: file.name, size: file.size, loaded: 0, status: "error", error: check.error })
          continue
        }
        next.push({ id, name: file.name, size: file.size, loaded: 0, status: "queued" })
        queue.push({ id, file })
      }
      setUploads((list) => [...list.filter((u) => u.status !== "done" && u.status !== "error"), ...next])
      pump()
    },
    clear() {
      setUploads((list) => list.filter((u) => u.status !== "done" && u.status !== "error"))
    },
  }
}

export function useUploader(folderId: string | null) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [queue] = useState(() => createQueue(folderId, setUploads))
  const { add, clear } = queue

  const busy = uploads.some((u) => u.status === "queued" || u.status === "uploading" || u.status === "saving")

  // Leaving mid-upload loses the rest of the queue: warn on a full unload.
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [busy])

  return { uploads, add, clear, busy }
}

/** Drop files anywhere on the list; an outline shows where they'll land. */
export function DropZone({
  onFiles,
  folderName,
  children,
}: {
  onFiles: (files: FileList) => void
  folderName: string
  children: ReactNode
}) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-accent-500 bg-secondary/80 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-body-strong text-text-accent">
            <CloudUpload className="size-5" />
            Drop to upload to {folderName}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The upload tray: floats above the page (and the tab bar on phones) so
 * progress stays in view while you scroll; collapses to one line.
 */
export function UploadPanel({ uploads, onClear }: { uploads: Upload[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  if (uploads.length === 0) return null
  const finished = uploads.every((u) => u.status === "done" || u.status === "error")
  const done = uploads.filter((u) => u.status === "done").length
  const failed = uploads.filter((u) => u.status === "error").length
  const total = uploads.reduce((a, u) => a + u.size, 0)
  const loaded = uploads.reduce((a, u) => a + (u.status === "done" ? u.size : u.loaded), 0)
  const overall = total ? Math.round((loaded / total) * 100) : 100
  return (
    <section
      aria-label="Uploads"
      className="glass glass-menu fixed right-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 grid w-[min(22rem,calc(100vw-1.5rem))] animate-in gap-2 rounded-xl p-3 shadow-(--shadow-glass-lg) duration-200 fade-in-0 slide-in-from-bottom-2 md:right-6 md:bottom-6 motion-reduce:animate-none"
    >
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="text-body-strong flex min-w-0 items-center gap-2 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CloudUpload className="size-4 shrink-0 text-text-accent" />
          <span className="truncate tabular-nums">
            {finished
              ? failed
                ? `${done} uploaded, ${failed} failed`
                : `${done} ${done === 1 ? "file" : "files"} uploaded`
              : `Uploading ${Math.min(done + 1, uploads.length)} of ${uploads.length} · ${overall}%`}
          </span>
        </button>
        {finished && (
          <button type="button" onClick={onClear} className="text-caption rounded px-1 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            Close
          </button>
        )}
      </header>
      {collapsed ? null : (
      <ul className="grid max-h-56 gap-2 overflow-y-auto" aria-live="polite">
        {uploads.map((u) => {
          const pct = u.size ? Math.round((u.loaded / u.size) * 100) : 100
          return (
            <li key={u.id} className="grid gap-1">
              <div className="flex items-center gap-2">
                {u.status === "done" ? (
                  <Check className="size-3.5 shrink-0 text-text-accent" aria-label="Uploaded" />
                ) : u.status === "error" ? (
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className="text-meta min-w-0 flex-1 truncate">{u.name}</span>
                <span className="text-caption shrink-0 text-muted-foreground tabular-nums">
                  {u.status === "error"
                    ? "Failed"
                    : u.status === "saving"
                      ? "Saving…"
                      : u.status === "done"
                        ? formatBytes(u.size)
                        : u.status === "queued"
                          ? "Waiting"
                          : `${pct}%`}
                </span>
              </div>
              {u.status === "error" ? (
                <p className="text-caption pl-5.5 text-destructive">{u.error}</p>
              ) : (
                u.status !== "done" && (
                  <div
                    className="ml-5.5 h-1 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`Uploading ${u.name}`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={cn("h-full rounded-full bg-primary transition-[width]")} style={{ width: `${pct}%` }} />
                  </div>
                )
              )}
            </li>
          )
        })}
      </ul>
      )}
    </section>
  )
}
