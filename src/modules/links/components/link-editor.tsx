"use client"

import { useState, useTransition } from "react"
import NextLink from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, ExternalLink, Loader2Icon, Refresh, Trash2 } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { deleteLink, refetchLink, restoreLink, updateLink } from "../server-actions"
import { domainOf, type Link } from "../schema"
import { Favicon } from "./favicon"

type Draft = {
  url: string
  title: string
  description: string
  tags: string
  note: string
  isPublic: boolean
  readLater: boolean
}

const fromLink = (link: Link): Draft => ({
  url: link.url,
  title: link.title,
  description: link.description,
  tags: link.tags.join(", "),
  note: link.note,
  isPublic: link.is_public,
  readLater: link.read_later,
})

export function LinkEditor({ link: initial }: { link: Link }) {
  const router = useRouter()
  const [link, setLink] = useState(initial)
  const [draft, setDraft] = useState<Draft>(() => fromLink(initial))
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const [fetching, startFetching] = useTransition()
  const [deleting, startDeleting] = useTransition()

  const dirty = JSON.stringify(draft) !== JSON.stringify(fromLink(link))
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startSaving(async () => {
      const result = await updateLink({ id: link.id, ...draft })
      if (!result.ok) return setError(result.error)
      setLink(result.data)
      setDraft(fromLink(result.data))
      toast.success("Changes saved")
    })
  }

  function refetch() {
    setError(null)
    startFetching(async () => {
      const result = await refetchLink({ id: link.id })
      if (!result.ok) return setError(result.error)
      setLink(result.data)
      setDraft((d) => ({ ...d, title: result.data.title, description: result.data.description }))
      toast.success("Title and icon updated")
    })
  }

  function remove() {
    startDeleting(async () => {
      const result = await deleteLink({ id: link.id })
      if (!result.ok) return void toast.error(result.error)
      const deleted = result.data
      router.push("/app/links")
      toast.success("Link deleted", {
        description: link.title,
        action: deleted
          ? {
              label: "Undo",
              onClick: async () => {
                const back = await restoreLink(deleted)
                if (!back.ok) toast.error(back.error)
              },
            }
          : undefined,
      })
    })
  }

  return (
    <div className="grid w-full max-w-2xl gap-3">
      <div className="flex min-h-9 items-center gap-2">
        <NextLink
          href="/app/links"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}
        >
          <ArrowLeft />
          Links
        </NextLink>
        <div className="ml-auto flex items-center gap-1">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ExternalLink />
            Open
          </a>
          <Button variant="ghost" size="sm" onClick={remove} disabled={deleting} className="hover:text-destructive">
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <form onSubmit={save} noValidate className="glass grid gap-4 rounded-xl p-4">
        <div className="flex items-center gap-2">
          <Favicon src={link.favicon_url} name={link.site_name || link.url.replace(/^https?:\/\//, "")} />
          <p className="text-meta min-w-0 truncate text-muted-foreground">{link.site_name || domainOf(link.url)}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refetch}
            disabled={fetching}
            className="ml-auto"
          >
            {fetching ? <Loader2Icon className="animate-spin" /> : <Refresh />}
            Fetch title again
          </Button>
        </div>

        <Field id="link-title" label="Title">
          <Input
            id="link-title"
            value={draft.title}
            maxLength={300}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Learn React"
          />
        </Field>
        <Field id="link-url" label="URL">
          <Input
            id="link-url"
            type="url"
            inputMode="url"
            value={draft.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder="e.g. https://react.dev/learn"
            className="font-mono"
          />
        </Field>
        <Field id="link-description" label="Description">
          <Textarea
            id="link-description"
            value={draft.description}
            maxLength={1000}
            onChange={(e) => set("description", e.target.value)}
            placeholder="e.g. The official tutorial, from components to hooks"
          />
        </Field>
        <Field id="link-tags" label="Tags" hint="Separate with commas or spaces.">
          <Input
            id="link-tags"
            value={draft.tags}
            onChange={(e) => set("tags", e.target.value)}
            placeholder="e.g. react, docs"
            autoComplete="off"
          />
        </Field>
        <Field id="link-note" label="Note" hint="Only you see this.">
          <Textarea
            id="link-note"
            value={draft.note}
            maxLength={5000}
            onChange={(e) => set("note", e.target.value)}
            placeholder="e.g. Chapter 3 explains effects well"
          />
        </Field>

        <fieldset className="grid gap-2">
          <legend className="text-eyebrow mb-2 text-muted-foreground">Options</legend>
          <Toggle
            checked={draft.readLater}
            onChange={(v) => set("readLater", v)}
            label="Read later"
            hint="Shows on Today until you clear it."
          />
          <Toggle
            checked={draft.isPublic}
            onChange={(v) => set("isPublic", v)}
            label="Public"
            hint="Listed on your public links page, grouped by tag. The note stays private."
          />
        </fieldset>

        {error && (
          <p role="alert" className="text-meta rounded-lg bg-error-surface px-3 py-2 text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setDraft(fromLink(link))}>
              Discard changes
            </Button>
          )}
          <Button type="submit" size="lg" disabled={saving || !dirty}>
            {saving && <Loader2Icon className="animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={id} className="text-eyebrow text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 -mx-2 hover:bg-track has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
      />
      <span className="grid gap-0.5">
        <span className="text-body">{label}</span>
        <span className="text-caption text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
