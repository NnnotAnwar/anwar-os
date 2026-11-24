"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, ArrowUpRight, Trash2 } from "@/components/icons"
import { Field, fieldClass, SaveStatus, Toggle } from "@/components/editor-fields"
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
import { formatTags, parseTags, slugify } from "@/lib/tags"
import { useAutosave } from "@/lib/use-autosave"
import { cn } from "@/lib/utils"
import { projectStatuses, statusLabels, type Project, type ProjectStatus } from "../schema"
import { deleteProject, saveProject } from "../server-actions"
import { GoalPicker } from "@/modules/goals/components/goal-picker"

type Form = {
  title: string
  slug: string
  summary: string
  body: string
  status: ProjectStatus
  role: string
  stack: string
  liveUrl: string
  repoUrl: string
  demoUrl: string
  coverUrl: string
  serviceName: string
  featured: boolean
  isPublic: boolean
}

function toForm(project: Project | null): Form {
  return {
    title: project?.title ?? "",
    slug: project?.slug ?? "",
    summary: project?.summary ?? "",
    body: project?.body ?? "",
    status: project?.status ?? "building",
    role: project?.role ?? "",
    stack: formatTags(project?.stack ?? []),
    liveUrl: project?.liveUrl ?? "",
    repoUrl: project?.repoUrl ?? "",
    demoUrl: project?.demoUrl ?? "",
    coverUrl: project?.coverUrl ?? "",
    serviceName: project?.serviceName ?? "",
    featured: project?.featured ?? false,
    isPublic: project?.isPublic ?? false,
  }
}

/**
 * One editor for new and existing projects, autosaving like notes: the project
 * is created once it has a title and the URL switches to it in place. The
 * address follows the title until the owner edits it by hand.
 */
export function ProjectEditor({
  project,
  timezone,
  locale,
}: {
  project: Project | null
  timezone: string
  locale: string
}) {
  const idRef = useRef<string | null>(project?.id ?? null)
  const [id, setId] = useState<string | null>(project?.id ?? null)
  const [savedSlug, setSavedSlug] = useState(project?.slug ?? "")
  const [savedPublic, setSavedPublic] = useState(project?.isPublic ?? false)
  // A new project's address tracks its title until the owner types one.
  const slugTouched = useRef(Boolean(project))
  const [pending, startTransition] = useTransition()

  const { value, update, status, flush, discard } = useAutosave<Form>({
    initial: toForm(project),
    initialSavedAt: project?.updatedAt ?? null,
    shortcut: true,
    validate: (v) => (v.title.trim() ? null : "A project needs a title before it can save."),
    save: async (v) => {
      const result = await saveProject(idRef.current, { ...v, stack: parseTags(v.stack) })
      if (!result.ok) return result
      if (!idRef.current) {
        idRef.current = result.id
        setId(result.id)
        window.history.replaceState(null, "", `/app/projects/${result.id}`)
      }
      setSavedSlug(result.slug)
      setSavedPublic(v.isPublic)
      if (!slugTouched.current && result.slug !== v.slug) update({ slug: result.slug })
      return { ok: true, updatedAt: result.updatedAt }
    },
  })

  function setTitle(title: string) {
    update(slugTouched.current ? { title } : { title, slug: slugify(title) })
  }

  /** Toggles save at once instead of waiting for the typing pause. */
  function setFlag(patch: Partial<Pick<Form, "isPublic" | "featured">>, message: string) {
    update(patch)
    void flush().then(() => toast.success(message))
  }

  function remove() {
    if (!id) return
    discard()
    startTransition(async () => {
      await deleteProject({ id })
      toast.success("Project deleted")
    })
  }

  return (
    <article className="mx-auto grid w-full max-w-5xl gap-4">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <Link
          href="/app/projects"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}
        >
          <ArrowLeft />
          Projects
        </Link>
        <SaveStatus
          status={status}
          idleText="Saves as you type once it has a title"
          timezone={timezone}
          locale={locale}
          className="min-w-0 flex-1"
        />
        <div className="ml-auto flex items-center gap-1">
          {id && savedPublic && (
            <Link
              href={`/projects/${savedSlug}`}
              target="_blank"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              View
              <ArrowUpRight />
            </Link>
          )}
          {id && (
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label="Delete project" />}>
                <Trash2 />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{value.title.trim() || "this project"}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The project and its case study are removed for good, including from the public site.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep project</AlertDialogCancel>
                  <Button variant="destructive" onClick={remove} disabled={pending}>
                    Delete project
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="glass grid gap-4 rounded-xl p-4 md:p-6" aria-label="Story">
          <div className="grid gap-1">
            <label htmlFor="project-title" className="sr-only">
              Title
            </label>
            <input
              id="project-title"
              value={value.title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project name"
              maxLength={120}
              autoFocus={!project}
              autoComplete="off"
              className="w-full bg-transparent font-display text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <Field label="Summary" hint="One or two sentences. Shows on cards and the landing page.">
            {(fid) => (
              <Textarea
                id={fid}
                value={value.summary}
                onChange={(e) => update({ summary: e.target.value })}
                maxLength={300}
                placeholder="e.g. Shift scheduling for restaurants and shops, with live presence and check-ins."
              />
            )}
          </Field>
          <Field label="Case study" hint="Markdown: # headings, - lists, **bold**, [links](https://…).">
            {(fid) => (
              <Textarea
                id={fid}
                value={value.body}
                onChange={(e) => update({ body: e.target.value })}
                placeholder={"## The problem\n\n## What I built\n\n## What I learned"}
                className="min-h-[40vh] leading-6"
              />
            )}
          </Field>
        </section>

        <aside className="grid gap-4" aria-label="Details">
          <section className="glass grid gap-4 rounded-xl p-4">
            <Toggle
              checked={value.isPublic}
              onChange={(isPublic) => setFlag({ isPublic }, isPublic ? "Published on /projects" : "Moved back to drafts")}
              label="Published"
              description="Visible on the public projects page."
            />
            <Toggle
              checked={value.featured}
              onChange={(featured) => setFlag({ featured }, featured ? "Featured on the landing page" : "No longer featured")}
              label="Featured"
              description="Shown on the landing page while published."
            />
          </section>

          <section className="glass grid gap-3 rounded-xl p-4">
            <Field label="Status">
              {(fid) => (
                <select
                  id={fid}
                  value={value.status}
                  onChange={(e) => update({ status: e.target.value as ProjectStatus })}
                  className={fieldClass}
                >
                  {projectStatuses.map((s) => (
                    <option key={s} value={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {id && <GoalPicker projectId={id} selectClassName={fieldClass} />}
            <Field label="Your role">
              {(fid) => (
                <input
                  id={fid}
                  value={value.role}
                  onChange={(e) => update({ role: e.target.value })}
                  placeholder="e.g. Product and full-stack"
                  maxLength={120}
                  className={fieldClass}
                />
              )}
            </Field>
            <Field label="Stack" hint="Separate with commas.">
              {(fid) => (
                <input
                  id={fid}
                  value={value.stack}
                  onChange={(e) => update({ stack: e.target.value })}
                  placeholder="e.g. React, TypeScript, Supabase"
                  className={fieldClass}
                />
              )}
            </Field>
            <Field label="Address" hint={`/projects/${value.slug || "…"}`}>
              {(fid) => (
                <input
                  id={fid}
                  value={value.slug}
                  onChange={(e) => {
                    slugTouched.current = true
                    update({ slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })
                  }}
                  placeholder="e.g. planuj-smeny"
                  maxLength={80}
                  autoComplete="off"
                  spellCheck={false}
                  className={fieldClass}
                />
              )}
            </Field>
          </section>

          <section className="glass grid gap-3 rounded-xl p-4">
            <UrlField label="Live site" value={value.liveUrl} onChange={(liveUrl) => update({ liveUrl })} />
            <UrlField label="Repository" value={value.repoUrl} onChange={(repoUrl) => update({ repoUrl })} />
            <UrlField label="Demo" value={value.demoUrl} onChange={(demoUrl) => update({ demoUrl })} />
            <Field label="Service in Ops" hint="The service that runs it, e.g. web. Your list then shows its deploy state. Never public.">
              {(fid) => (
                <input
                  id={fid}
                  value={value.serviceName}
                  onChange={(e) => update({ serviceName: e.target.value.trim().toLowerCase() })}
                  placeholder="e.g. web"
                  maxLength={63}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={fieldClass}
                />
              )}
            </Field>
            <UrlField
              label="Cover image"
              value={value.coverUrl}
              onChange={(coverUrl) => update({ coverUrl })}
              hint="A link to a 16:9 image. Leave empty for a plain card."
            />
            {/^https?:\/\//.test(value.coverUrl) && (
              // Arbitrary owner-supplied hosts: next/image would need each one allow-listed.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.coverUrl} alt="" className="aspect-video w-full rounded-lg border object-cover" />
            )}
          </section>
        </aside>
      </div>
    </article>
  )
}

function UrlField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
}) {
  return (
    <Field label={label} hint={hint}>
      {(fid) => (
        <input
          id={fid}
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://"
          autoComplete="off"
          spellCheck={false}
          className={fieldClass}
        />
      )}
    </Field>
  )
}
