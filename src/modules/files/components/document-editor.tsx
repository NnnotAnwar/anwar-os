"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Eye, Pencil, Trash2 } from "@/components/icons"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { folderHref } from "../lib/links"
import { renderMarkdown } from "../lib/markdown"
import { createDocument, deleteDocument, saveDocument } from "../server-actions"
import { proseClass } from "./prose"

type Props = {
  timezone: string
  locale: string
  folderId: string | null
} & (
  | { mode: "create" }
  | { mode: "edit"; id: string; initialTitle: string; initialBody: string; initialUpdatedAt: string }
)

type Status =
  | { kind: "draft" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string }

const AUTOSAVE_MS = 800

/**
 * Markdown document editor with autosave (same save queue as notes) and a
 * rendered view. New documents are created once they have a title, and the
 * URL switches in place so the editor never remounts mid-sentence.
 */
export function DocumentEditor(props: Props) {
  const router = useRouter()
  const initial =
    props.mode === "edit"
      ? { id: props.id, title: props.initialTitle, body: props.initialBody }
      : { id: null, title: "", body: "" }

  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [id, setId] = useState<string | null>(initial.id)
  const [view, setView] = useState<"write" | "read">(props.mode === "edit" && initial.body ? "read" : "write")
  const [status, setStatus] = useState<Status>(
    props.mode === "edit" ? { kind: "saved", at: props.initialUpdatedAt } : { kind: "draft" },
  )
  const [pending, startTransition] = useTransition()

  const latest = useRef({ title: initial.title, body: initial.body })
  const saved = useRef({ title: initial.title, body: initial.body })
  const idRef = useRef<string | null>(initial.id)
  const inFlight = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { folderId } = props

  const persist = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    while (inFlight.current) await inFlight.current
    const snapshot = { ...latest.current }
    if (snapshot.title === saved.current.title && snapshot.body === saved.current.body) return
    if (!snapshot.title.trim()) {
      if (idRef.current) setStatus({ kind: "error", message: "A document needs a title before it can save." })
      return
    }
    setStatus({ kind: "saving" })
    const run = async () => {
      const result = idRef.current
        ? await saveDocument({ id: idRef.current, ...snapshot })
        : await createDocument({ ...snapshot, folderId })
      if (!result.ok) {
        setStatus({ kind: "error", message: result.error })
        return
      }
      saved.current = snapshot
      if (!idRef.current) {
        idRef.current = result.id
        setId(result.id)
        window.history.replaceState(null, "", `/app/files/doc/${result.id}`)
      }
      const upToDate = latest.current.title === snapshot.title && latest.current.body === snapshot.body
      setStatus(upToDate ? { kind: "saved", at: result.updatedAt } : { kind: "dirty" })
    }
    inFlight.current = run().finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [folderId])

  function edit(next: { title?: string; body?: string }) {
    latest.current = { ...latest.current, ...next }
    if (next.title !== undefined) setTitle(next.title)
    if (next.body !== undefined) setBody(next.body)
    setStatus({ kind: "dirty" })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void persist()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [persist])

  const unsaved = status.kind === "dirty" || status.kind === "saving" || (status.kind === "error" && id !== null)
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [unsaved])

  useEffect(() => () => void persist(), [persist])

  const html = useMemo(() => (view === "read" ? renderMarkdown(body) : ""), [view, body])

  function remove() {
    if (!id) return
    clearTimeout(timer.current)
    saved.current = latest.current
    startTransition(async () => {
      const result = await deleteDocument({ id })
      if (result.ok) router.push(folderHref(folderId))
    })
  }

  return (
    <article className="glass grid gap-4 rounded-xl p-4 sm:p-6">
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <div className="segmented" role="tablist" aria-label="View">
          {(
            [
              ["write", "Write", Pencil],
              ["read", "Preview", Eye],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                "text-small flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                view === key && "segment-active text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        <SaveStatus status={status} timezone={props.timezone} locale={props.locale} />
        {id && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label="Delete document" className="ml-auto" />}>
              <Trash2 />
            </AlertDialogTrigger>
            <AlertDialogContent className="glass glass-menu">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-card-title">Delete “{title.trim() || "this document"}”?</AlertDialogTitle>
                <AlertDialogDescription>The document is removed for good. This can&apos;t be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep document</AlertDialogCancel>
                <Button variant="destructive" onClick={remove} disabled={pending}>
                  Delete document
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <label htmlFor="doc-title" className="sr-only">
        Title
      </label>
      <input
        id="doc-title"
        value={title}
        onChange={(e) => edit({ title: e.target.value })}
        placeholder="Title"
        maxLength={200}
        autoFocus={props.mode === "create"}
        autoComplete="off"
        className="w-full bg-transparent font-display text-xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 md:text-2xl"
      />

      {view === "write" ? (
        <>
          <label htmlFor="doc-body" className="sr-only">
            Body (markdown)
          </label>
          <textarea
            id="doc-body"
            value={body}
            onChange={(e) => edit({ body: e.target.value })}
            placeholder={"e.g. ## Checklist\n- [ ] Passport\n- [ ] Tickets"}
            spellCheck
            className="field-sizing-content min-h-[50vh] w-full resize-none bg-transparent font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground/60"
          />
        </>
      ) : body.trim() ? (
        <div className={proseClass} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-meta text-muted-foreground">Nothing written yet. Switch to Write to start.</p>
      )}
    </article>
  )
}

function SaveStatus({ status, timezone, locale }: { status: Status; timezone: string; locale: string }) {
  const text = (() => {
    switch (status.kind) {
      case "draft":
        return "Saves as you type once it has a title"
      case "dirty":
        return "Unsaved changes"
      case "saving":
        return "Saving…"
      case "saved":
        return `Saved ${new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
          timeZone: timezone,
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(status.at))}`
      case "error":
        return status.message
    }
  })()
  return (
    <p role="status" aria-live="polite" className={cn("text-caption truncate text-muted-foreground tabular-nums", status.kind === "error" && "text-destructive")}>
      {text}
    </p>
  )
}
