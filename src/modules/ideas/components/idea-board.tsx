"use client"

import { useOptimistic, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Eye, EyeSlash, Plus, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatRelative } from "@/lib/time"
import { cn } from "@/lib/utils"
import { ideaStatuses, ideaStatusLabels, type Idea, type IdeaStatus } from "../schema"
import { deleteIdea, quickAddIdea, setIdeaPublic, setIdeaStatus } from "../server-actions"

/** One-line capture: type, press Enter, keep going. */
export function QuickAdd() {
  const [title, setTitle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = title.trim()
    if (!value) {
      setError("Write the idea first — a few words are enough.")
      return
    }
    startTransition(async () => {
      const result = await quickAddIdea(value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTitle("")
      setError(null)
      toast.success("Idea added")
      input.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className="glass grid gap-2 rounded-xl p-3" aria-label="Add an idea">
      <div className="flex gap-2">
        <label htmlFor="quick-idea" className="sr-only">
          New idea
        </label>
        <Input
          ref={input}
          id="quick-idea"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (error) setError(null)
          }}
          placeholder="e.g. Telegram bot that splits a shared bill"
          maxLength={200}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "quick-idea-error" : undefined}
          className="h-9"
        />
        <Button type="submit" size="lg" disabled={pending}>
          <Plus />
          Add idea
        </Button>
      </div>
      {error && (
        <p id="quick-idea-error" className="text-caption text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

type Change =
  | { type: "status"; id: string; status: IdeaStatus }
  | { type: "public"; id: string; value: boolean }
  | { type: "remove"; id: string }

/**
 * The board as dense rows. Status, publishing and delete each take one tap and
 * offer Undo; a delete only reaches the database once its toast has gone.
 */
export function IdeaList({ ideas, locale, now }: { ideas: Idea[]; locale: string; now: string }) {
  const [, startTransition] = useTransition()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [optimistic, apply] = useOptimistic(ideas, (list, change: Change) => {
    switch (change.type) {
      case "status":
        return list.map((idea) => (idea.id === change.id ? { ...idea, status: change.status } : idea))
      case "public":
        return list.map((idea) => (idea.id === change.id ? { ...idea, isPublic: change.value } : idea))
      case "remove":
        return list.filter((idea) => idea.id !== change.id)
    }
  })
  const visible = optimistic.filter((idea) => !hidden.has(idea.id))
  const nowDate = new Date(now)

  function changeStatus(idea: Idea, status: IdeaStatus) {
    const previous = idea.status
    startTransition(async () => {
      apply({ type: "status", id: idea.id, status })
      await setIdeaStatus({ id: idea.id, status })
      toast.success(`Moved to ${ideaStatusLabels[status].toLowerCase()}`, {
        action: { label: "Undo", onClick: () => startTransition(() => setIdeaStatus({ id: idea.id, status: previous })) },
      })
    })
  }

  function togglePublic(idea: Idea) {
    const value = !idea.isPublic
    startTransition(async () => {
      apply({ type: "public", id: idea.id, value })
      await setIdeaPublic({ id: idea.id, value })
      toast.success(value ? "Published on /ideas" : "Private again", {
        action: { label: "Undo", onClick: () => startTransition(() => setIdeaPublic({ id: idea.id, value: !value })) },
      })
    })
  }

  function remove(idea: Idea) {
    setHidden((prev) => new Set(prev).add(idea.id))
    let undone = false
    const commit = () => {
      if (!undone) startTransition(() => deleteIdea({ id: idea.id }))
    }
    toast.success("Idea deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          undone = true
          setHidden((prev) => {
            const next = new Set(prev)
            next.delete(idea.id)
            return next
          })
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    })
  }

  if (visible.length === 0) {
    return <p className="text-meta glass rounded-xl p-4 text-muted-foreground">Nothing here right now.</p>
  }

  return (
    <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
      {visible.map((idea) => (
        <li key={idea.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 sm:flex-nowrap">
          <Link
            href={`/app/ideas/${idea.id}`}
            className="grid min-w-0 flex-1 basis-full gap-0.5 rounded-lg px-1 py-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:basis-auto"
          >
            <span className={`text-body-strong ${cn("truncate", idea.status === "dropped" && "text-muted-foreground line-through")}`}>
              {idea.title}
            </span>
            <span className="text-caption flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <time dateTime={idea.updatedAt} className="shrink-0 tabular-nums">
                {formatRelative(new Date(idea.updatedAt), nowDate, locale)}
              </time>
              {idea.tags.length > 0 && <span className="truncate">· {idea.tags.join(", ")}</span>}
            </span>
          </Link>
          <label className="sr-only" htmlFor={`status-${idea.id}`}>
            Status of “{idea.title}”
          </label>
          <select
            id={`status-${idea.id}`}
            value={idea.status}
            onChange={(e) => changeStatus(idea, e.target.value as IdeaStatus)}
            className="text-small h-8 rounded-lg border border-field-border bg-field px-2 outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 max-sm:ml-0"
          >
            {ideaStatuses.map((s) => (
              <option key={s} value={s}>
                {ideaStatusLabels[s]}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => togglePublic(idea)}
            aria-pressed={idea.isPublic}
            aria-label={idea.isPublic ? `Make “${idea.title}” private` : `Publish “${idea.title}”`}
            title={idea.isPublic ? "Public · tap to make private" : "Private · tap to publish"}
            className={cn("ml-auto sm:ml-0", idea.isPublic ? "text-text-accent" : "text-muted-foreground")}
          >
            {idea.isPublic ? <Eye /> : <EyeSlash />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => remove(idea)}
            aria-label={`Delete “${idea.title}”`}
            className="text-muted-foreground"
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  )
}
