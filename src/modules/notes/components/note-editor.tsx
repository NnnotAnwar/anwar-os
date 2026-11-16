"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { ArrowLeft, Pin, PinOff, Trash2 } from "@/components/icons"
import { toast } from "sonner"
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
import { Button, buttonVariants } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { createNote, deleteNote, saveNote, setNotePinned } from "../server-actions"

type Props = {
  timezone: string
  locale: string
} & (
  | { mode: "create" }
  | {
      mode: "edit"
      id: string
      initialTitle: string
      initialBody: string
      initialPinned: boolean
      initialUpdatedAt: string
    }
)

type Status =
  | { kind: "draft" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string }

const AUTOSAVE_MS = 800

/**
 * One editor for new and existing notes. Everything autosaves: a new note is
 * created as soon as it has a title, and the URL switches to it in place
 * (history.replaceState) so the editor never remounts mid-sentence.
 */
export function NoteEditor(props: Props) {
  const initial =
    props.mode === "edit"
      ? { id: props.id, title: props.initialTitle, body: props.initialBody, pinned: props.initialPinned }
      : { id: null, title: "", body: "", pinned: false }

  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [id, setId] = useState<string | null>(initial.id)
  const [pinned, setPinned] = useState(initial.pinned)
  const [status, setStatus] = useState<Status>(
    props.mode === "edit" ? { kind: "saved", at: props.initialUpdatedAt } : { kind: "draft" },
  )
  const [pending, startTransition] = useTransition()

  // Refs mirror state for the save queue, which runs outside React's render cycle.
  const latest = useRef({ title: initial.title, body: initial.body })
  const saved = useRef({ title: initial.title, body: initial.body })
  const idRef = useRef<string | null>(initial.id)
  const inFlight = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  /** Sends the latest text if it differs from what the server has. Serialized. */
  const persist = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    while (inFlight.current) await inFlight.current
    const snapshot = { ...latest.current }
    if (snapshot.title === saved.current.title && snapshot.body === saved.current.body) return
    if (!snapshot.title.trim()) {
      if (idRef.current) setStatus({ kind: "error", message: "A note needs a title before it can save." })
      return
    }

    setStatus({ kind: "saving" })
    const run = async () => {
      const result = idRef.current
        ? await saveNote({ id: idRef.current, ...snapshot })
        : await createNote(snapshot)
      if (!result.ok) {
        setStatus({ kind: "error", message: result.error })
        return
      }
      saved.current = snapshot
      if (!idRef.current) {
        idRef.current = result.id
        setId(result.id)
        window.history.replaceState(null, "", `/app/notes/${result.id}`)
      }
      const upToDate = latest.current.title === snapshot.title && latest.current.body === snapshot.body
      setStatus(upToDate ? { kind: "saved", at: result.updatedAt } : { kind: "dirty" })
    }
    inFlight.current = run().finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [])

  function edit(next: { title?: string; body?: string }) {
    latest.current = { ...latest.current, ...next }
    if (next.title !== undefined) setTitle(next.title)
    if (next.body !== undefined) setBody(next.body)
    setStatus({ kind: "dirty" })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS)
  }

  // ⌘S / Ctrl+S saves right away instead of waiting for the pause.
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

  // Leaving the page: warn on a full unload, and flush on in-app navigation.
  const unsaved = status.kind === "dirty" || status.kind === "saving" || (status.kind === "error" && id !== null)
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [unsaved])

  useEffect(() => () => void persist(), [persist])

  function togglePin() {
    if (!id) return
    const next = !pinned
    setPinned(next)
    startTransition(async () => {
      await setNotePinned({ id, pinned: next })
      toast.success(next ? "Pinned to Today" : "Unpinned")
    })
  }

  function remove() {
    if (!id) return
    clearTimeout(timer.current)
    // Nothing left to save once it's gone.
    saved.current = latest.current
    startTransition(async () => {
      await deleteNote({ id })
      toast.success("Note deleted")
    })
  }

  return (
    <article className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="flex min-h-9 items-center gap-2">
        <Link
          href="/app/notes"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}
        >
          <ArrowLeft />
          Notes
        </Link>
        <SaveStatus status={status} timezone={props.timezone} locale={props.locale} />
        {id && (
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={togglePin}
                    aria-pressed={pinned}
                    aria-label={pinned ? "Unpin note" : "Pin note"}
                    className={cn(pinned && "text-text-accent")}
                  />
                }
              >
                {pinned ? <PinOff /> : <Pin />}
              </TooltipTrigger>
              <TooltipContent>{pinned ? "Unpin" : "Pin to Today"}</TooltipContent>
            </Tooltip>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label="Delete note" />}>
                <Trash2 />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{title.trim() || "this note"}”?</AlertDialogTitle>
                  <AlertDialogDescription>The note is removed for good. This can’t be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep note</AlertDialogCancel>
                  <Button variant="destructive" onClick={remove} disabled={pending}>
                    Delete note
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="grid gap-3">
        <label htmlFor="note-title" className="sr-only">
          Title
        </label>
        <input
          id="note-title"
          value={title}
          onChange={(e) => edit({ title: e.target.value })}
          placeholder="Title"
          maxLength={200}
          autoFocus={props.mode === "create"}
          autoComplete="off"
          className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 md:text-3xl"
        />
        <label htmlFor="note-body" className="sr-only">
          Body
        </label>
        <textarea
          id="note-body"
          value={body}
          onChange={(e) => edit({ body: e.target.value })}
          placeholder="Write anything. Markdown is fine."
          className="field-sizing-content min-h-[50vh] w-full resize-none bg-transparent text-base leading-7 outline-none placeholder:text-muted-foreground/60"
        />
      </div>
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
        return `Saved ${new Intl.DateTimeFormat(locale, {
          timeZone: timezone,
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(status.at))}`
      case "error":
        return status.message
    }
  })()

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn("truncate font-mono text-xs text-muted-foreground", status.kind === "error" && "text-destructive")}
    >
      {text}
    </p>
  )
}
