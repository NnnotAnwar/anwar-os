"use client"

import { useEffect, useRef, useState, type ComponentType } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { NAV_TAB } from "@/components/motion"
import {
  CalendarPlus,
  ExternalLink,
  Lightbulb,
  LinkIcon,
  ListChecks,
  Loader2Icon,
  NotebookPen,
  Trash2,
} from "@/components/icons"
import { Kbd } from "@/components/ui/kbd"
import { isTyping, useAfterG } from "@/lib/keys"
import { formatRelative } from "@/lib/time"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { hostOf } from "../lib/extract"
import { outcomeLabels, outcomeModules, type InboxItem, type InboxOutcome } from "../schema"
import { deleteInboxItem, processInboxItem, unprocessInboxItem, updateInboxItem } from "../server-actions"
import { CaptureForm } from "./capture-sheet"

type Choice = InboxOutcome | "delete"

const CHOICES: { key: Choice; label: string; icon: ComponentType<{ className?: string }>; hint: string }[] = [
  { key: "task", label: "Task", icon: ListChecks, hint: "Dates in the text are read: “tomorrow 10:00”" },
  { key: "note", label: "Note", icon: NotebookPen, hint: "First line becomes the title" },
  { key: "link", label: "Link", icon: LinkIcon, hint: "Saves the link with this text as a note" },
  { key: "idea", label: "Idea", icon: Lightbulb, hint: "Lands in Ideas as raw" },
  { key: "event", label: "Event", icon: CalendarPlus, hint: "Needs a day or time: “Dentist fri 14:00”" },
  { key: "delete", label: "Delete", icon: Trash2, hint: "Not needed after all" },
]

export type InboxView = "process" | "processed"

export function InboxApp({
  view,
  items,
  processed,
  now,
  locale,
  focusItemId,
  autoCapture,
}: {
  view: InboxView
  items: InboxItem[]
  processed: InboxItem[]
  now: string
  locale: string
  focusItemId: string | null
  autoCapture: boolean
}) {
  return (
    <div className="grid gap-3">
      <nav aria-label="Inbox views" className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="segmented">
          {(
            [
              ["process", "To process", "/app/inbox", items.length],
              ["processed", "Processed", "/app/inbox?view=processed", null],
            ] as const
          ).map(([key, label, href, count]) => (
            <li key={key}>
              <Link
                href={href}
                transitionTypes={NAV_TAB}
                scroll={false}
                aria-current={view === key ? "page" : undefined}
                className={cn(
                  "text-small flex h-8 items-center gap-1.5 rounded-lg px-3 whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-md:h-9",
                  view === key && "segment-active text-foreground",
                )}
              >
                {label}
                {count ? <span className="text-caption tabular-nums opacity-70">{count}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {view === "process" ? (
        <Processor items={items} now={now} locale={locale} focusItemId={focusItemId} autoCapture={autoCapture} />
      ) : (
        <Processed items={processed} now={now} locale={locale} />
      )}
    </div>
  )
}

function Processor({
  items,
  now,
  locale,
  focusItemId,
  autoCapture,
}: {
  items: InboxItem[]
  now: string
  locale: string
  focusItemId: string | null
  autoCapture: boolean
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [currentId, setCurrentId] = useState<string | null>(focusItemId)
  const [leaving, setLeaving] = useState<{ id: string; dir: "left" | "down" } | null>(null)
  const [busy, setBusy] = useState<Choice | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const afterG = useAfterG()

  const visible = items.filter((i) => !hidden.has(i.id))
  const current = visible.find((i) => i.id === currentId) ?? visible[0] ?? null
  const position = current ? visible.indexOf(current) : -1
  const text = current ? (drafts[current.id] ?? current.text) : ""

  const setHide = (id: string, value: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })

  async function choose(choice: Choice) {
    if (!current || busy) return
    const item = current
    const edited = drafts[item.id]
    const changed = edited !== undefined && edited.trim() !== item.text ? edited : undefined
    const next = visible[position + 1] ?? visible[position - 1] ?? null

    if (choice === "delete") {
      setLeaving({ id: item.id, dir: "down" })
      await new Promise((r) => setTimeout(r, 180))
      setLeaving(null)
      setCurrentId(next?.id ?? null)
      removeWithUndo({
        message: "Deleted from inbox",
        hide: () => setHide(item.id, true),
        restore: () => {
          setHide(item.id, false)
          setCurrentId(item.id)
        },
        commit: () => deleteInboxItem({ id: item.id }),
      })
      return
    }

    if (choice === "link" && !item.url) {
      toast.error("There's no link in this item — paste one into the text, or make it a note.")
      return
    }
    setBusy(choice)
    const result = await processInboxItem({ id: item.id, as: choice, text: changed })
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setLeaving({ id: item.id, dir: "left" })
    await new Promise((r) => setTimeout(r, 180))
    setLeaving(null)
    setHide(item.id, true)
    setCurrentId(next?.id ?? null)
    const { name } = outcomeModules[result.value.outcome]
    toast.success(`Added to ${name}`, {
      description: (
        <Link href={result.value.href} className="underline underline-offset-4">
          Open “{result.value.title.slice(0, 60)}”
        </Link>
      ),
      action: {
        label: "Undo",
        onClick: () => {
          setHide(item.id, false)
          setCurrentId(item.id)
          void unprocessInboxItem({ id: item.id }).then((r) => !r.ok && toast.error(r.error))
        },
      },
    })
  }

  // Keys 1–6 pick an action; ←/→ (or J/K) walk the queue. Never while typing.
  const keyState = useRef({ choose, visible, position })
  useEffect(() => {
    keyState.current = { choose, visible, position }
  })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || afterG(e)) return
      if (document.querySelector("[data-slot=dialog-content]:not([data-closed])")) return
      const s = keyState.current
      const n = Number(e.key)
      if (n >= 1 && n <= CHOICES.length) {
        e.preventDefault()
        void s.choose(CHOICES[n - 1]!.key)
      } else if ((e.key === "ArrowRight" || e.key === "j") && s.visible.length > 1) {
        e.preventDefault()
        setCurrentId(s.visible[(s.position + 1) % s.visible.length]!.id)
      } else if ((e.key === "ArrowLeft" || e.key === "k") && s.visible.length > 1) {
        e.preventDefault()
        setCurrentId(s.visible[(s.position - 1 + s.visible.length) % s.visible.length]!.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [afterG])

  function saveDraft() {
    if (!current) return
    const edited = drafts[current.id]
    if (edited === undefined || edited.trim() === current.text || (!edited.trim() && !current.url)) return
    void updateInboxItem({ id: current.id, text: edited })
  }

  const nowDate = new Date(now)
  const rest = visible.filter((i) => i.id !== current?.id)

  return (
    <div className="grid gap-4">
      <CaptureForm
        compact
        autoFocus={autoCapture}
        onDone={(queued) => toast.success(queued ? "Saved on this device · syncs when you're online" : "Captured")}
      />

      {!current ? (
        <div className="glass grid justify-items-center gap-2 rounded-xl px-6 py-10 text-center">
          <p className="text-card-title">Inbox zero</p>
          <p className="text-meta max-w-sm text-muted-foreground">
            Nothing waiting. Press <Kbd>C</Kbd> anywhere in the app to capture a thought before it slips away.
          </p>
        </div>
      ) : (
        <section aria-label="Process the next item" className="grid gap-3">
          <article
            key={current.id}
            className={cn(
              "glass grid gap-3 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] duration-200 animate-in fade-in-0 slide-in-from-right-3 md:p-5",
              leaving?.id === current.id && "translate-x-[-24px] opacity-0 transition-[translate,opacity] duration-150",
              leaving?.id === current.id && leaving.dir === "down" && "translate-x-0 translate-y-3",
            )}
          >
            <p className="text-eyebrow flex flex-wrap items-center gap-x-2 gap-y-1 text-text-accent">
              <span className="tabular-nums">
                {position + 1} of {visible.length}
              </span>
              <span className="text-muted-foreground normal-case tracking-normal">
                · {formatRelative(new Date(current.createdAt), nowDate, locale)}
                {current.source !== "app" && ` · via ${current.source}`}
              </span>
            </p>
            <label htmlFor="inbox-current" className="sr-only">
              Item text — edit before you sort it
            </label>
            <textarea
              id="inbox-current"
              value={text}
              onChange={(e) => setDrafts((d) => ({ ...d, [current.id]: e.target.value }))}
              onBlur={saveDraft}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur()
              }}
              rows={Math.min(8, Math.max(2, text.split("\n").length))}
              placeholder={current.url ? "Add a note about this link" : ""}
              maxLength={10_000}
              // Grows with wrapped lines too (rows only counts line breaks, so a long
              // sentence was cut off at two lines on a phone); rows stays as the fallback.
              className="text-card-title -mx-2 field-sizing-content max-h-[calc(8lh+0.5rem)] min-h-[calc(2lh+0.5rem)] resize-none rounded-lg bg-transparent px-2 py-1 font-display leading-snug outline-none hover:bg-white/30 focus-visible:bg-field focus-visible:ring-3 focus-visible:ring-accent-500/20 dark:hover:bg-white/5"
            />
            {current.url && (
              <a
                href={current.url}
                target="_blank"
                rel="noreferrer"
                className="text-meta flex w-fit max-w-full items-center gap-1.5 rounded-lg bg-track px-2.5 py-1.5 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <LinkIcon className="size-3.5 shrink-0" />
                <span className="truncate">{hostOf(current.url)}</span>
                <ExternalLink className="size-3 shrink-0 opacity-70" />
              </a>
            )}
          </article>

          <div role="group" aria-label="Turn it into" className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {CHOICES.map((c, index) => {
              const disabled = (c.key === "link" && !current.url) || (busy !== null && busy !== c.key)
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => void choose(c.key)}
                  disabled={disabled}
                  title={c.key === "link" && !current.url ? "No link in this item" : c.hint}
                  aria-keyshortcuts={String(index + 1)}
                  className={cn(
                    "press glass relative grid h-20 place-items-center content-center gap-1.5 rounded-xl outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-45",
                    c.key === "delete" ? "hover:text-destructive" : "hover:bg-accent-500/10 hover:text-text-accent",
                  )}
                >
                  {busy === c.key ? <Loader2Icon className="size-5 animate-spin" /> : <c.icon className="size-5" />}
                  <span className="text-body-strong">{c.label}</span>
                  <Kbd className="absolute top-1.5 right-1.5 hidden md:inline-flex">{index + 1}</Kbd>
                </button>
              )
            })}
          </div>
          <p className="text-caption hidden px-1 text-muted-foreground md:block">
            Press <Kbd>1</Kbd>–<Kbd>6</Kbd> to sort, <Kbd>←</Kbd> <Kbd>→</Kbd> to skip. Edit the text first if it helps —
            a task reads dates like “tomorrow 10:00”, an event needs a day or time.
          </p>

          {rest.length > 0 && (
            <section aria-labelledby="up-next" className="grid gap-1.5">
              <h2 id="up-next" className="text-heading px-1">
                Up next
              </h2>
              <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
                {rest.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setCurrentId(item.id)}
                      className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-white/45 focus-visible:bg-accent-500/10 dark:hover:bg-white/5"
                    >
                      <span className="text-body min-w-0 flex-1 truncate">
                        {item.text.split("\n")[0] || (item.url ? hostOf(item.url) : "")}
                      </span>
                      {item.url && item.text && (
                        <span className="text-caption shrink-0 text-muted-foreground">{hostOf(item.url)}</span>
                      )}
                      <span className="text-caption shrink-0 text-muted-foreground tabular-nums">
                        {formatRelative(new Date(item.createdAt), nowDate, locale)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
    </div>
  )
}

function Processed({ items, now, locale }: { items: InboxItem[]; now: string; locale: string }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const visible = items.filter((i) => !hidden.has(i.id))
  const nowDate = new Date(now)
  if (visible.length === 0) {
    return (
      <div className="glass grid gap-1 rounded-xl p-6">
        <p className="text-card-title">Nothing processed yet</p>
        <p className="text-meta text-muted-foreground">Items you sort show up here, so you can find where they went.</p>
      </div>
    )
  }
  return (
    <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
      {visible.map((item) => {
        const outcome = item.processedAs!
        const href = item.processedRef ? hrefFor(outcome, item.processedRef) : null
        return (
          <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            <span className="text-caption shrink-0 rounded-md bg-accent-500/10 px-1.5 py-0.5 font-semibold text-text-accent">
              {outcomeLabels[outcome]}
            </span>
            <span className="text-body min-w-0 flex-1 truncate">{item.text.split("\n")[0] || (item.url ? hostOf(item.url) : "")}</span>
            <span className="text-caption text-muted-foreground tabular-nums">
              {formatRelative(new Date(item.processedAt!), nowDate, locale)}
            </span>
            {href && (
              <Link href={href} className="text-caption text-text-accent underline-offset-4 hover:underline">
                Open
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setHidden((prev) => new Set(prev).add(item.id))
                void unprocessInboxItem({ id: item.id }).then((r) => {
                  if (r.ok) toast.success(`Back in the inbox${item.processedRef ? ` — the ${outcomeLabels[outcome].toLowerCase()} was removed` : ""}`)
                  else {
                    setHidden((prev) => {
                      const next = new Set(prev)
                      next.delete(item.id)
                      return next
                    })
                    toast.error(r.error)
                  }
                })
              }}
              className="text-caption rounded px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Put back
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function hrefFor(outcome: InboxOutcome, id: string) {
  switch (outcome) {
    case "task":
      return `/app/tasks?task=${id}`
    case "note":
      return `/app/notes/${id}`
    case "link":
      return `/app/links/${id}`
    case "idea":
      return `/app/ideas/${id}`
    case "event":
      return `/app/calendar?event=${id}`
  }
}
