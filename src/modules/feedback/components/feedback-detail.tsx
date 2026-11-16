"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import NextLink from "next/link"
import { toast } from "sonner"
import { ArrowLeft, ShieldWarning, Trash2 } from "@/components/icons"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { contactHref, statusLabels, type FeedbackItem, type FeedbackStatus } from "../schema"
import { deleteFeedback, markFeedbackRead, saveReplyNote, setFeedbackStatus } from "../server-actions"
import { KindBadge } from "./badges"

const triage: FeedbackStatus[] = ["new", "read", "in_progress", "done"]

type NoteStatus = { kind: "idle" } | { kind: "dirty" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }

export function FeedbackDetail({
  item,
  timezone,
  locale,
}: {
  item: FeedbackItem
  timezone: string
  locale: string
}) {
  // Opening something new counts as reading it; the list shows it as read next time.
  const [status, setStatus] = useState<FeedbackStatus>(item.status === "new" ? "read" : item.status)
  const [, startTransition] = useTransition()
  const [deleting, startDeleting] = useTransition()

  useEffect(() => {
    if (item.status === "new") void markFeedbackRead({ id: item.id })
  }, [item.id, item.status])

  function changeStatus(next: FeedbackStatus) {
    if (next === status) return
    const previous = status
    setStatus(next)
    startTransition(async () => {
      const result = await setFeedbackStatus({ id: item.id, status: next })
      if (!result.ok) {
        setStatus(previous)
        return void toast.error(result.error)
      }
      toast.success(next === "spam" ? "Marked as spam" : `Marked ${statusLabels[next].toLowerCase()}`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              setStatus(previous)
              const back = await setFeedbackStatus({ id: item.id, status: previous })
              if (!back.ok) toast.error(back.error)
            }),
        },
      })
    })
  }

  const created = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(item.created_at))
  const href = item.contact ? contactHref(item.contact) : null

  return (
    <article className="grid w-full max-w-3xl gap-3">
      <div className="flex min-h-9 items-center gap-2">
        <NextLink
          href="/app/feedback"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}
        >
          <ArrowLeft />
          Feedback
        </NextLink>
        <div className="ml-auto flex items-center gap-1">
          {status === "spam" ? (
            <Button variant="ghost" size="sm" onClick={() => changeStatus("read")}>
              Not spam
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => changeStatus("spam")}>
              <ShieldWarning />
              Mark spam
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="hover:text-destructive" />}>
              <Trash2 />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this feedback?</AlertDialogTitle>
                <AlertDialogDescription>
                  The message and your notes are removed for good. This can’t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={deleting}
                  onClick={() =>
                    startDeleting(async () => {
                      await deleteFeedback({ id: item.id })
                      toast.success("Feedback deleted")
                    })
                  }
                >
                  Delete feedback
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <section aria-label="Message" className="glass grid gap-3 rounded-xl p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <KindBadge kind={item.kind} />
          <span className="text-meta font-semibold">{item.name || "Anonymous"}</span>
          {item.contact &&
            (href ? (
              <a
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="text-meta text-text-accent hover:underline"
              >
                {item.contact}
              </a>
            ) : (
              <span className="text-meta text-muted-foreground">{item.contact}</span>
            ))}
          <time dateTime={item.created_at} className="text-caption ml-auto text-muted-foreground tabular-nums">
            {created}
          </time>
        </div>
        <p className="text-sm leading-6 font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">{item.message}</p>
      </section>

      <section aria-labelledby="status-heading" className="glass grid gap-2 rounded-xl p-4">
        <h2 id="status-heading" className="text-eyebrow text-muted-foreground">
          Status
        </h2>
        <div role="radiogroup" aria-labelledby="status-heading" className="segmented flex-wrap justify-self-start">
          {triage.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => changeStatus(s)}
              className={`text-small ${cn(
                "rounded-lg px-3 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                status === s && "segment-active text-foreground",
              )}`}
            >
              {statusLabels[s]}
            </button>
          ))}
        </div>
        {status === "spam" && (
          <p className="text-caption text-destructive">Marked as spam — hidden from the inbox.</p>
        )}
      </section>

      <ReplyNote id={item.id} initial={item.reply_note} />
    </article>
  )
}

const AUTOSAVE_MS = 800

/** Private notes: how you answered, what you changed. Autosaves like a note. */
function ReplyNote({ id, initial }: { id: string; initial: string }) {
  const [value, setValue] = useState(initial)
  const [status, setStatus] = useState<NoteStatus>({ kind: "idle" })
  const latest = useRef(initial)
  const saved = useRef(initial)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inFlight = useRef<Promise<void> | null>(null)

  const persist = useCallback(async () => {
    clearTimeout(timer.current)
    while (inFlight.current) await inFlight.current
    const snapshot = latest.current
    if (snapshot === saved.current) return
    setStatus({ kind: "saving" })
    inFlight.current = (async () => {
      const result = await saveReplyNote({ id, replyNote: snapshot })
      if (!result.ok) return setStatus({ kind: "error", message: result.error })
      saved.current = snapshot
      setStatus(latest.current === snapshot ? { kind: "saved" } : { kind: "dirty" })
    })().finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [id])

  useEffect(() => () => void persist(), [persist])

  useEffect(() => {
    if (status.kind !== "dirty" && status.kind !== "saving") return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [status.kind])

  const label = {
    idle: "Only you see this. Saves as you type.",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    error: status.kind === "error" ? status.message : "",
  }[status.kind]

  return (
    <section aria-labelledby="reply-heading" className="glass grid gap-2 rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="reply-heading" className="text-eyebrow text-muted-foreground">
          <label htmlFor="reply-note">Reply notes</label>
        </h2>
        <p
          role="status"
          aria-live="polite"
          className={`text-caption ${cn("text-muted-foreground", status.kind === "error" && "text-destructive")}`}
        >
          {label}
        </p>
      </div>
      <Textarea
        id="reply-note"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          latest.current = e.target.value
          setStatus({ kind: "dirty" })
          clearTimeout(timer.current)
          timer.current = setTimeout(() => void persist(), AUTOSAVE_MS)
        }}
        onBlur={() => void persist()}
        placeholder="e.g. Replied on Telegram 16 Nov, fixed in the next release"
        className="min-h-28"
      />
    </section>
  )
}
