"use client"

import { useOptimistic, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Eye, EyeSlash, StarFill } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { formatRelative } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { Project } from "../schema"
import { moveProject, setProjectPublished } from "../server-actions"
import { StatusPill } from "./status-pill"

/** The showcase in its public order. Arrows reorder; the eye publishes in one tap. */
export function ProjectList({ projects, locale, now }: { projects: Project[]; locale: string; now: string }) {
  const [pending, startTransition] = useTransition()
  const [optimistic, apply] = useOptimistic(
    projects,
    (list, change: { type: "move"; id: string; direction: "up" | "down" } | { type: "publish"; id: string; value: boolean }) => {
      if (change.type === "publish") return list.map((p) => (p.id === change.id ? { ...p, isPublic: change.value } : p))
      const from = list.findIndex((p) => p.id === change.id)
      const to = change.direction === "up" ? from - 1 : from + 1
      if (from < 0 || to < 0 || to >= list.length) return list
      const next = [...list]
      ;[next[from], next[to]] = [next[to]!, next[from]!]
      return next
    },
  )

  function move(id: string, direction: "up" | "down") {
    startTransition(async () => {
      apply({ type: "move", id, direction })
      await moveProject({ id, direction })
    })
  }

  function publish(project: Project) {
    const value = !project.isPublic
    startTransition(async () => {
      apply({ type: "publish", id: project.id, value })
      await setProjectPublished({ id: project.id, value })
      toast.success(value ? `“${project.title}” is published` : `“${project.title}” is back in drafts`, {
        action: {
          label: "Undo",
          onClick: () => startTransition(() => setProjectPublished({ id: project.id, value: !value })),
        },
      })
    })
  }

  const nowDate = new Date(now)

  return (
    <ol className="glass divide-y divide-hairline overflow-hidden rounded-xl" aria-busy={pending}>
      {optimistic.map((project, index) => (
        <li key={project.id} className="flex items-center gap-2 px-2 py-2 sm:px-3">
          <div className="flex flex-col">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => move(project.id, "up")}
              disabled={index === 0}
              aria-label={`Move “${project.title}” up`}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => move(project.id, "down")}
              disabled={index === optimistic.length - 1}
              aria-label={`Move “${project.title}” down`}
            >
              <ArrowDown />
            </Button>
          </div>
          <Link
            href={`/app/projects/${project.id}`}
            className="grid min-w-0 flex-1 gap-0.5 rounded-lg px-2 py-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {project.featured && <StarFill className="size-3.5 shrink-0 text-text-accent" aria-label="Featured" />}
              <span className="text-body-strong truncate">{project.title}</span>
            </span>
            <span className="text-meta flex min-w-0 items-center gap-2 text-muted-foreground">
              <StatusPill status={project.status} />
              <span className={cn("truncate", !project.isPublic && "italic")}>
                {project.isPublic ? `/projects/${project.slug}` : "Draft"}
              </span>
              <time dateTime={project.updatedAt} className="ml-auto shrink-0 tabular-nums max-sm:hidden">
                {formatRelative(new Date(project.updatedAt), nowDate, locale)}
              </time>
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => publish(project)}
            aria-pressed={project.isPublic}
            aria-label={project.isPublic ? `Unpublish “${project.title}”` : `Publish “${project.title}”`}
            title={project.isPublic ? "Published · tap to unpublish" : "Draft · tap to publish"}
            className={cn(project.isPublic ? "text-text-accent" : "text-muted-foreground")}
          >
            {project.isPublic ? <Eye /> : <EyeSlash />}
          </Button>
        </li>
      ))}
    </ol>
  )
}
