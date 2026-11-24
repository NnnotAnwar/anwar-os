"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowUpRight, Rss } from "@/components/icons"
import { Field, fieldClass, Toggle } from "@/components/editor-fields"
import { buttonVariants } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { notePublishingInput, type Note } from "../schema"
import { setNotePublishing } from "../server-actions"

export type Publishing = Pick<Note, "isPublic" | "slug" | "excerpt" | "publishedAt">

const SAVE_MS = 800

/** YYYY-MM-DD of an instant in the viewer's time zone (what a date input shows). */
function dayIn(iso: string | null, timezone: string) {
  if (!iso) return ""
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  )
}

/**
 * Publishing a note on /writing: one toggle publishes it at once (the address
 * comes from the title), and while it's public the address, an optional
 * summary and the date show up underneath and save as you type. Unpublishing
 * takes it off /writing, the feeds and the sitemap on the next request.
 */
export function NotePublishing({
  noteId,
  initial,
  timezone,
}: {
  noteId: string
  initial: Publishing
  timezone: string
}) {
  const [isPublic, setIsPublic] = useState(initial.isPublic)
  const [slug, setSlug] = useState(initial.slug ?? "")
  const [excerpt, setExcerpt] = useState(initial.excerpt)
  const [date, setDate] = useState(dayIn(initial.publishedAt, timezone))
  const [savedSlug, setSavedSlug] = useState(initial.slug ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  // The latest field values for the debounced save, plus whether the owner set a date.
  const latest = useRef({ slug, excerpt, date, dateTouched: false })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function apply(note: Note) {
    setIsPublic(note.isPublic)
    setSavedSlug(note.slug ?? "")
    // Fill in what the server derived (address, first-publish date); keep what's being typed.
    if (!latest.current.slug && note.slug) {
      latest.current.slug = note.slug
      setSlug(note.slug)
    }
    if (!latest.current.dateTouched) {
      const day = dayIn(note.publishedAt, timezone)
      latest.current.date = day
      setDate(day)
    }
  }

  async function send(nextPublic: boolean) {
    const { slug, excerpt, date, dateTouched } = latest.current
    const input = { id: noteId, isPublic: nextPublic, slug, excerpt, publishedOn: dateTouched ? date : "" }
    const parsed = notePublishingInput.safeParse(input)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the address and try again.")
      return false
    }
    const result = await setNotePublishing(parsed.data)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    apply(result.note)
    return true
  }

  function toggle(next: boolean) {
    clearTimeout(timer.current)
    setIsPublic(next)
    startSaving(async () => {
      const ok = await send(next)
      if (!ok) return setIsPublic(!next)
      toast.success(next ? "Published on /writing" : "Taken off /writing", {
        description: next ? "It's in the RSS feed too." : "Only you can see it now.",
        action: { label: "Undo", onClick: () => toggle(!next) },
      })
    })
  }

  function edit(patch: Partial<typeof latest.current>) {
    latest.current = { ...latest.current, ...patch }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => startSaving(async () => void (await send(isPublic))), SAVE_MS)
  }

  const address = `/writing/${savedSlug || slug || "…"}`

  return (
    <section className="glass grid gap-4 rounded-xl p-4" aria-label="Publishing">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Toggle
            checked={isPublic}
            onChange={toggle}
            disabled={saving && !isPublic && !savedSlug}
            label="Publish on /writing"
            description={
              isPublic ? `Public at ${address} and in the RSS feed.` : "Only you can see this note. One tap puts it on your site."
            }
          />
        </div>
        {isPublic && savedSlug && (
          <Link
            href={`/writing/${savedSlug}`}
            target="_blank"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-sm:h-11")}
          >
            View
            <ArrowUpRight />
          </Link>
        )}
      </div>

      {isPublic && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <Field label="Address" hint={address}>
            {(fid) => (
              <input
                id={fid}
                value={slug}
                onChange={(e) => {
                  const value = e.target.value.toLowerCase().replace(/\s+/g, "-")
                  setSlug(value)
                  edit({ slug: value })
                }}
                placeholder="e.g. why-i-self-host"
                maxLength={80}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={error?.includes("address") || undefined}
                className={cn(fieldClass, "max-md:h-11 max-md:text-base")}
              />
            )}
          </Field>
          <Field label="Date">
            {(fid) => (
              <input
                id={fid}
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  edit({ date: e.target.value, dateTouched: true })
                }}
                className={cn(fieldClass, "max-md:h-11 max-md:text-base dark:[color-scheme:dark]")}
              />
            )}
          </Field>
          <Field
            label="Summary (optional)"
            hint="Shown on /writing and in the feed. Without one, the note's first lines are used."
            className="sm:col-span-2"
          >
            {(fid) => (
              <Textarea
                id={fid}
                value={excerpt}
                onChange={(e) => {
                  setExcerpt(e.target.value)
                  edit({ excerpt: e.target.value })
                }}
                maxLength={300}
                rows={2}
                placeholder="One or two sentences about the note."
              />
            )}
          </Field>
        </div>
      )}

      {(error || (isPublic && saving)) && (
        <p role="status" aria-live="polite" className={cn("text-caption text-muted-foreground", error && "text-destructive")}>
          {error ?? "Saving…"}
        </p>
      )}
      {isPublic && !error && (
        <p className="text-caption flex items-center gap-1.5 text-muted-foreground">
          <Rss className="size-3.5" />
          Readers can follow /writing/feed.xml in any RSS reader.
        </p>
      )}
    </section>
  )
}
