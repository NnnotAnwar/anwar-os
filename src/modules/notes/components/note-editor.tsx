"use client"

import { useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Pin, PinOff, TextBold, TextItalic, Trash2 } from "@/components/icons"
import { NAV_BACK } from "@/components/motion"
import { pendingRemovals } from "@/components/list/pending"
import { Button, buttonVariants } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { continueList, countWords, taskProgress, toggleTask, wrapSelection } from "../lib/checklist"
import { createNote, deleteNotes, pinNotes, saveNote } from "../server-actions"
import { NotePreview } from "./note-preview"

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
 *
 * Write / Preview: the preview renders markdown and makes "- [ ]" checklists
 * tappable; tapping anywhere else in it goes back to writing.
 */
export function NoteEditor(props: Props) {
  const router = useRouter()
  const initial =
    props.mode === "edit"
      ? { id: props.id, title: props.initialTitle, body: props.initialBody, pinned: props.initialPinned }
      : { id: null, title: "", body: "", pinned: false }

  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [id, setId] = useState<string | null>(initial.id)
  const [pinned, setPinned] = useState(initial.pinned)
  const [view, setView] = useState<"write" | "preview">(
    // Existing notes open read-first, like Notes on iOS; new ones open ready to type.
    props.mode === "edit" && initial.body.trim() ? "preview" : "write",
  )
  const [status, setStatus] = useState<Status>(
    props.mode === "edit" ? { kind: "saved", at: props.initialUpdatedAt } : { kind: "draft" },
  )
  const [, startTransition] = useTransition()
  const textarea = useRef<HTMLTextAreaElement>(null)

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
  }, [setId])

  function edit(next: { title?: string; body?: string }) {
    latest.current = { ...latest.current, ...next }
    if (next.title !== undefined) setTitle(next.title)
    if (next.body !== undefined) setBody(next.body)
    setStatus({ kind: "dirty" })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS)
  }

  /** Applies a text change made by a shortcut and keeps the cursor where it belongs. */
  function replaceBody(value: string, start: number, end = start) {
    edit({ body: value })
    requestAnimationFrame(() => {
      const el = textarea.current
      if (!el) return
      el.focus()
      el.setSelectionRange(start, end)
    })
  }

  function format(marker: "**" | "_") {
    const el = textarea.current
    if (!el) return
    const next = wrapSelection(body, el.selectionStart, el.selectionEnd, marker)
    replaceBody(next.value, next.start, next.end)
  }

  function onBodyKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault()
      format("**")
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "i") {
      e.preventDefault()
      format("_")
    } else if (e.key === "Enter" && !mod && !e.shiftKey && !e.nativeEvent.isComposing) {
      const el = e.currentTarget
      if (el.selectionStart !== el.selectionEnd) return
      const next = continueList(body, el.selectionStart)
      if (!next) return
      e.preventDefault()
      replaceBody(next.value, next.caret)
    }
  }

  function switchView(next: "write" | "preview") {
    setView(next)
    if (next === "write") requestAnimationFrame(() => textarea.current?.focus())
  }

  // ⌘S saves right away; ⌘E flips between writing and preview.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === "s") {
        e.preventDefault()
        void persist()
      } else if (key === "e" && !e.shiftKey) {
        e.preventDefault()
        setView((v) => {
          const next = v === "write" ? "preview" : "write"
          if (next === "write") requestAnimationFrame(() => textarea.current?.focus())
          return next
        })
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
      const result = await pinNotes({ ids: [id], pinned: next })
      if (!result.ok) {
        setPinned(!next)
        return void toast.error(result.error)
      }
      toast.success(next ? "Pinned to Today" : "Unpinned")
    })
  }

  /** One tap: back to the list at once, Undo brings the note back here. */
  function remove() {
    if (!id) return
    clearTimeout(timer.current)
    // Nothing left to save once it's gone.
    saved.current = latest.current
    const noteId = id
    removeWithUndo({
      message: `“${title.trim() || "Note"}” deleted`,
      hide: () => {
        pendingRemovals.add(noteId)
        router.push("/app/notes", { transitionTypes: NAV_BACK })
      },
      restore: () => {
        pendingRemovals.remove(noteId)
        router.push(`/app/notes/${noteId}`)
      },
      commit: () => deleteNotes({ ids: [noteId] }),
    })
  }

  const words = countWords(body)
  const progress = taskProgress(body)

  return (
    <article className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex min-h-9 items-center gap-2">
        <Link
          href="/app/notes"
          transitionTypes={NAV_BACK}
          className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "-ml-2.5 text-muted-foreground")}
        >
          <ArrowLeft />
          Notes
        </Link>
        <SaveStatus status={status} timezone={props.timezone} locale={props.locale} />
        <div className="ml-auto flex items-center gap-1">
          <nav aria-label="Mode" className="segmented">
            {(["write", "preview"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => switchView(v)}
                title={`${v === "write" ? "Write" : "Preview"} (⌘E)`}
                className={cn(
                  "text-small h-7 rounded-lg px-2.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-8",
                  view === v && "segment-active text-foreground",
                )}
              >
                {v === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </nav>
          {id && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-lg"
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      onClick={remove}
                      aria-label="Delete note"
                      className="hover:text-destructive"
                    />
                  }
                >
                  <Trash2 />
                </TooltipTrigger>
                <TooltipContent>Delete — you can undo</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        <label htmlFor="note-title" className="sr-only">
          Title
        </label>
        <input
          id="note-title"
          value={title}
          onChange={(e) => edit({ title: e.target.value })}
          onKeyDown={(e) => {
            // Enter in the title moves on to the body, like every notes app.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault()
              switchView("write")
            }
          }}
          placeholder="Title"
          maxLength={200}
          autoFocus={props.mode === "create"}
          autoComplete="off"
          enterKeyHint="next"
          className="font-display w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 md:text-3xl"
        />

        {view === "write" ? (
          <>
            <div className="flex items-center gap-1 text-muted-foreground" role="toolbar" aria-label="Formatting">
              <Button variant="ghost" size="icon" aria-label="Bold (⌘B)" title="Bold (⌘B)" onClick={() => format("**")} className="pointer-coarse:size-10">
                <TextBold />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Italic (⌘I)" title="Italic (⌘I)" onClick={() => format("_")} className="pointer-coarse:size-10">
                <TextItalic />
              </Button>
              <p className="text-caption ml-2 hidden text-muted-foreground pointer-fine:block">
                Markdown works. <Kbd>- [ ]</Kbd> makes a checklist, <Kbd>⌘E</Kbd> previews.
              </p>
            </div>
            <label htmlFor="note-body" className="sr-only">
              Body
            </label>
            <textarea
              ref={textarea}
              id="note-body"
              value={body}
              onChange={(e) => edit({ body: e.target.value })}
              onKeyDown={onBodyKeyDown}
              placeholder="Write anything. Markdown is fine; “- [ ] ” starts a checklist."
              className="field-sizing-content min-h-[50vh] w-full resize-none bg-transparent text-base leading-7 outline-none placeholder:text-muted-foreground/60"
            />
          </>
        ) : (
          <NotePreview
            body={body}
            onToggle={(line) => edit({ body: toggleTask(body, line) })}
            onEdit={() => switchView("write")}
          />
        )}
      </div>

      <footer className="text-caption flex items-center gap-2 border-t border-hairline pt-2 text-muted-foreground tabular-nums">
        <span>
          {words} {words === 1 ? "word" : "words"}
        </span>
        {progress && (
          <span>
            · {progress.done} of {progress.total} done
          </span>
        )}
      </footer>
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
      className={cn("text-caption truncate text-muted-foreground max-sm:hidden", status.kind === "error" && "text-destructive max-sm:block")}
    >
      {text}
    </p>
  )
}
