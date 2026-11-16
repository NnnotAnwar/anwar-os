"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Trash2 } from "@/components/icons"
import { Field, fieldClass, SaveStatus, Toggle } from "@/components/editor-fields"
import { Button, buttonVariants } from "@/components/ui/button"
import { formatTags, parseTags } from "@/lib/tags"
import { useAutosave } from "@/lib/use-autosave"
import { cn } from "@/lib/utils"
import { ideaStatuses, ideaStatusLabels, type Idea, type IdeaStatus } from "../schema"
import { deleteIdeaAndReturn, saveIdea } from "../server-actions"

type Form = { title: string; body: string; status: IdeaStatus; tags: string; isPublic: boolean }

/** Autosaving detail view, the same flow as a note: created once it has a title. */
export function IdeaEditor({ idea, timezone, locale }: { idea: Idea | null; timezone: string; locale: string }) {
  const idRef = useRef<string | null>(idea?.id ?? null)
  const [id, setId] = useState<string | null>(idea?.id ?? null)
  const [pending, startTransition] = useTransition()

  const { value, update, status, flush, discard } = useAutosave<Form>({
    initial: {
      title: idea?.title ?? "",
      body: idea?.body ?? "",
      status: idea?.status ?? "raw",
      tags: formatTags(idea?.tags ?? []),
      isPublic: idea?.isPublic ?? false,
    },
    initialSavedAt: idea?.updatedAt ?? null,
    shortcut: true,
    validate: (v) => (v.title.trim() ? null : "An idea needs a title before it can save."),
    save: async (v) => {
      const result = await saveIdea(idRef.current, { ...v, tags: parseTags(v.tags) })
      if (!result.ok) return result
      if (!idRef.current) {
        idRef.current = result.id
        setId(result.id)
        window.history.replaceState(null, "", `/app/ideas/${result.id}`)
      }
      return { ok: true, updatedAt: result.updatedAt }
    },
  })

  function setNow(patch: Partial<Form>, message: string) {
    update(patch)
    void flush().then(() => toast.success(message))
  }

  function remove() {
    if (!id) return
    discard()
    startTransition(async () => {
      await deleteIdeaAndReturn({ id })
      toast.success("Idea deleted")
    })
  }

  return (
    <article className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex min-h-9 items-center gap-2">
        <Link
          href="/app/ideas"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}
        >
          <ArrowLeft />
          Ideas
        </Link>
        <SaveStatus
          status={status}
          idleText="Saves as you type once it has a title"
          timezone={timezone}
          locale={locale}
          className="min-w-0 flex-1"
        />
        {id && (
          <Button variant="ghost" size="icon" onClick={remove} disabled={pending} aria-label="Delete idea">
            <Trash2 />
          </Button>
        )}
      </div>

      <div className="glass grid gap-4 rounded-xl p-4 md:p-6">
        <label htmlFor="idea-title" className="sr-only">
          Title
        </label>
        <input
          id="idea-title"
          value={value.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="What's the idea?"
          maxLength={200}
          autoFocus={!idea}
          autoComplete="off"
          className="w-full bg-transparent font-display text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60"
        />
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Field label="Status">
            {(fid) => (
              <select
                id={fid}
                value={value.status}
                onChange={(e) =>
                  setNow({ status: e.target.value as IdeaStatus }, `Moved to ${ideaStatusLabels[e.target.value as IdeaStatus].toLowerCase()}`)
                }
                className={fieldClass}
              >
                {ideaStatuses.map((s) => (
                  <option key={s} value={s}>
                    {ideaStatusLabels[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Tags" hint="Separate with commas.">
            {(fid) => (
              <input
                id={fid}
                value={value.tags}
                onChange={(e) => update({ tags: e.target.value })}
                placeholder="e.g. telegram, side project"
                className={fieldClass}
              />
            )}
          </Field>
        </div>
        <Toggle
          checked={value.isPublic}
          onChange={(isPublic) => setNow({ isPublic }, isPublic ? "Published on /ideas" : "Private again")}
          label="Public"
          description="Show this idea and its notes on the public ideas page."
        />
        <div className="grid gap-1.5">
          <label htmlFor="idea-body" className="text-small text-muted-foreground">
            Notes
          </label>
          <textarea
            id="idea-body"
            value={value.body}
            onChange={(e) => update({ body: e.target.value })}
            placeholder="Why it matters, who it's for, the first step. Markdown is fine."
            className="field-sizing-content min-h-[40vh] w-full resize-none bg-transparent text-[15px] leading-7 outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>
    </article>
  )
}
