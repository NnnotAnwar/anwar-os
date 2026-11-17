"use client"

import { useEffect, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, Eye, EyeSlash, GripVertical, LightbulbDuo, MoreHorizontal, Pencil, Trash2 } from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { pendingRemovals, usePendingRemovals } from "@/components/list/pending"
import { RowContextMenu } from "@/components/list/row-menu"
import { EmptyState, ShortcutHint } from "@/components/list/shortcut-hint"
import { SwipeRow, type RowAction } from "@/components/list/swipe-row"
import { useListKeyboard } from "@/components/list/use-list-keyboard"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatRelative } from "@/lib/time"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { columns, moveIdea, neighbourStatus, nextStage, startsDrag } from "../lib/board"
import { ideaStatuses, ideaStatusLabels, type Idea, type IdeaStatus } from "../schema"
import { deleteIdea, setIdeaPublic, setIdeaStatus } from "../server-actions"
import { IdeaStatusPill } from "./idea-status"

/** Shared state for both views: optimistic status / publish changes, deletes with Undo. */
function useIdeas(initial: Idea[]) {
  const [ideas, setIdeas] = useState(initial)
  const [last, setLast] = useState(initial)
  // The server's list wins whenever it changes (after a revalidate).
  if (last !== initial) {
    setLast(initial)
    setIdeas(initial)
  }
  const removed = usePendingRemovals()
  const [, startTransition] = useTransition()

  function changeStatus(idea: Idea, status: IdeaStatus, undoable = true) {
    const previous = idea.status
    if (previous === status) return
    setIdeas((list) => moveIdea(list, idea.id, status))
    startTransition(async () => {
      try {
        await setIdeaStatus({ id: idea.id, status })
      } catch {
        setIdeas((list) => moveIdea(list, idea.id, previous))
        return void toast.error("That didn't save. Check your connection and try again.")
      }
      if (!undoable) return
      toast.success(`Moved to ${ideaStatusLabels[status].toLowerCase()}`, {
        action: { label: "Undo", onClick: () => changeStatus({ ...idea, status }, previous, false) },
      })
    })
  }

  function togglePublic(idea: Idea, undoable = true) {
    const value = !idea.isPublic
    setIdeas((list) => list.map((i) => (i.id === idea.id ? { ...i, isPublic: value } : i)))
    startTransition(async () => {
      try {
        await setIdeaPublic({ id: idea.id, value })
      } catch {
        setIdeas((list) => list.map((i) => (i.id === idea.id ? { ...i, isPublic: !value } : i)))
        return void toast.error("That didn't save. Check your connection and try again.")
      }
      if (!undoable) return
      toast.success(value ? "Published on /ideas" : "Private again", {
        action: { label: "Undo", onClick: () => togglePublic({ ...idea, isPublic: value }, false) },
      })
    })
  }

  function remove(idea: Idea) {
    removeWithUndo({
      message: `“${idea.title}” deleted`,
      hide: () => pendingRemovals.add(idea.id),
      restore: () => pendingRemovals.remove(idea.id),
      commit: async () => {
        try {
          await deleteIdea({ id: idea.id })
          return { ok: true }
        } catch {
          return { ok: false, error: "The idea wasn't deleted. Try again." }
        }
      },
    })
  }

  return { ideas: ideas.filter((i) => !removed.has(i.id)), changeStatus, togglePublic, remove }
}

function menuActions(
  idea: Idea,
  ops: ReturnType<typeof useIdeas>,
  open: () => void,
): RowAction[] {
  const next = nextStage(idea.status)
  return [
    ...(next
      ? [{ id: "next", label: `Move to ${ideaStatusLabels[next].toLowerCase()}`, icon: ArrowRight, tone: "accent" as const, onSelect: () => ops.changeStatus(idea, next), shortcut: "→" }]
      : []),
    ...ideaStatuses
      .filter((s) => s !== idea.status && s !== next)
      .map((s) => ({ id: `to-${s}`, label: `Move to ${ideaStatusLabels[s].toLowerCase()}`, icon: ArrowRight, onSelect: () => ops.changeStatus(idea, s) })),
    {
      id: "public",
      label: idea.isPublic ? "Make private" : "Publish on /ideas",
      icon: idea.isPublic ? EyeSlash : Eye,
      onSelect: () => ops.togglePublic(idea),
      shortcut: "P",
    },
    { id: "edit", label: "Open", icon: Pencil, onSelect: open, shortcut: "↵" },
    { id: "delete", label: "Delete", icon: Trash2, tone: "destructive", onSelect: () => ops.remove(idea), shortcut: "⌫" },
  ]
}

/* ───────────────────────── List ───────────────────────── */

/**
 * Dense rows. Swipe right to move an idea to its next stage, left to delete;
 * long-press or right-click for every status. Keys: J/K, Enter, P, ⌫.
 */
export function IdeaRows({ ideas: initial, locale, now }: { ideas: Idea[]; locale: string; now: string }) {
  const router = useRouter()
  const ops = useIdeas(initial)
  const { ideas } = ops
  const container = useRef<HTMLUListElement>(null)
  const nowDate = new Date(now)
  const byId = new Map(ideas.map((i) => [i.id, i]))
  const open = (id: string) => router.push(`/app/ideas/${id}`, { transitionTypes: NAV_FORWARD })

  useListKeyboard({
    container,
    handlers: {
      new: () => document.getElementById("quick-idea")?.focus(),
      open: (id) => id && open(id),
      edit: (id) => id && open(id),
      pin: (id) => {
        const idea = id && byId.get(id)
        if (idea) ops.togglePublic(idea)
      },
      delete: (id) => {
        const idea = id && byId.get(id)
        if (idea) ops.remove(idea)
      },
    },
    extra: {
      ArrowRight: (id) => {
        const idea = id && byId.get(id)
        const next = idea && nextStage(idea.status)
        if (idea && next) ops.changeStatus(idea, next)
      },
    },
  })

  if (ideas.length === 0) {
    return <p className="text-meta glass rounded-xl p-4 text-muted-foreground">Nothing here right now.</p>
  }

  return (
    <div className="grid gap-2">
      <ul ref={container} className="glass divide-y divide-hairline overflow-hidden rounded-xl">
        {ideas.map((idea) => {
          const actions = menuActions(idea, ops, () => open(idea.id))
          const next = nextStage(idea.status)
          return (
            <li key={idea.id} data-row-id={idea.id}>
              <SwipeRow
                leading={next ? { ...actions[0]!, label: ideaStatusLabels[next] } : undefined}
                trailing={[actions.at(-1)!]}
              >
                <RowContextMenu actions={actions} label={idea.title}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Link
                      data-row-primary
                      href={`/app/ideas/${idea.id}`}
                      transitionTypes={NAV_FORWARD}
                      className="grid min-w-0 flex-1 gap-0.5 rounded-lg px-1 py-1 outline-none hover:bg-white/40 focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-white/5"
                    >
                      <span className={cn("text-body-strong truncate", idea.status === "dropped" && "text-muted-foreground line-through")}>
                        {idea.title}
                      </span>
                      <span className="text-caption flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <IdeaStatusPill status={idea.status} className="sm:hidden" />
                        <time dateTime={idea.updatedAt} className="shrink-0 tabular-nums">
                          {formatRelative(new Date(idea.updatedAt), nowDate, locale)}
                        </time>
                        {idea.tags.length > 0 && <span className="truncate">· {idea.tags.join(", ")}</span>}
                        {idea.isPublic && <Eye className="size-3 shrink-0 text-text-accent sm:hidden" aria-label="Public" />}
                      </span>
                    </Link>
                    <div className="hidden shrink-0 items-center gap-1 sm:flex">
                      <label className="sr-only" htmlFor={`status-${idea.id}`}>
                        Status of “{idea.title}”
                      </label>
                      <select
                        id={`status-${idea.id}`}
                        value={idea.status}
                        onChange={(e) => ops.changeStatus(idea, e.target.value as IdeaStatus)}
                        className="text-small h-8 rounded-lg border border-field-border bg-field px-2 outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 dark:[color-scheme:dark]"
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
                        onClick={() => ops.togglePublic(idea)}
                        aria-pressed={idea.isPublic}
                        aria-label={idea.isPublic ? `Make “${idea.title}” private` : `Publish “${idea.title}”`}
                        title={idea.isPublic ? "Public · click to make private (P)" : "Private · click to publish (P)"}
                        className={cn(idea.isPublic ? "text-text-accent" : "text-muted-foreground")}
                      >
                        {idea.isPublic ? <Eye /> : <EyeSlash />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => ops.remove(idea)}
                        aria-label={`Delete “${idea.title}”`}
                        title="Delete (⌫)"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </RowContextMenu>
              </SwipeRow>
            </li>
          )
        })}
      </ul>
      <ShortcutHint
        items={[
          [["J", "K"], "move"],
          [["↵"], "open"],
          [["→"], "next stage"],
          [["P"], "publish"],
          [["⌫"], "delete"],
          [["N"], "new"],
        ]}
        touch="Swipe right to move an idea on, left to delete. Hold for every status."
      />
    </div>
  )
}

/* ───────────────────────── Board ───────────────────────── */

type Drag = {
  id: string
  pointerId: number
  pointer: "mouse" | "touch" | "pen"
  x0: number
  y0: number
  t0: number
  started: boolean
  ghost: HTMLElement | null
  dx: number
  dy: number
  over: IdeaStatus | null
  /** Removes the window listeners this drag added. */
  off: () => void
}

const columnTone: Record<IdeaStatus, string> = {
  raw: "bg-muted-foreground/40",
  exploring: "bg-accent-300",
  building: "bg-accent-500",
  shipped: "bg-accent-700 dark:bg-accent-300",
  dropped: "bg-transparent ring-1 ring-muted-foreground/50",
}

/**
 * Kanban: one column per status. Drag a card to another column (mouse:
 * just drag; touch: hold, then drag). Keyboard: Space picks the focused card
 * up, ← / → choose a column, Space drops, Esc cancels.
 */
export function IdeaBoard({ ideas: initial }: { ideas: Idea[] }) {
  const ops = useIdeas(initial)
  const [dragging, setDragging] = useState<{ id: string; over: IdeaStatus | null } | null>(null)
  const [lifted, setLifted] = useState<{ id: string; from: IdeaStatus; to: IdeaStatus } | null>(null)
  const [announce, setAnnounce] = useState("")
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const refocus = useRef<string | null>(null)

  // Shown in the target column while a card is lifted with the keyboard.
  const shown = lifted ? ops.ideas.map((i) => (i.id === lifted.id ? { ...i, status: lifted.to } : i)) : ops.ideas
  const board = columns(shown)

  // A card changes column (and remounts): keep keyboard focus on it.
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    document.querySelector<HTMLElement>(`[data-card-id="${id}"] a`)?.focus()
  })

  function cleanup() {
    const d = drag.current
    d?.ghost?.remove()
    d?.off()
    drag.current = null
    setDragging(null)
  }

  function blockScroll(e: TouchEvent) {
    if (drag.current?.started) e.preventDefault()
  }

  function begin(d: Drag) {
    const card = document.querySelector<HTMLElement>(`[data-card-id="${d.id}"]`)
    if (!card) return
    const rect = card.getBoundingClientRect()
    const ghost = card.cloneNode(true) as HTMLElement
    ghost.removeAttribute("data-card-id")
    ghost.setAttribute("aria-hidden", "true")
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      zIndex: "60",
      pointerEvents: "none",
      transform: "rotate(1.5deg) scale(1.03)",
      boxShadow: "var(--shadow-glass-lg)",
      transition: "none",
    })
    document.body.appendChild(ghost)
    d.ghost = ghost
    d.dx = d.x0 - rect.left
    d.dy = d.y0 - rect.top
    d.started = true
    suppressClick.current = true
    navigator.vibrate?.(10)
    const from = ops.ideas.find((i) => i.id === d.id)?.status ?? null
    d.over = from
    setDragging({ id: d.id, over: from })
  }

  function onMove(e: PointerEvent) {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!d.started) {
      const verdict = startsDrag(d.pointer, e.clientX - d.x0, e.clientY - d.y0, e.timeStamp - d.t0)
      if (verdict === "cancel") return cleanup()
      if (verdict === "wait") return
      begin(d)
    }
    if (!d.ghost) return
    d.ghost.style.left = `${e.clientX - d.dx}px`
    d.ghost.style.top = `${e.clientY - d.dy}px`
    const over = (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-column]") as HTMLElement | null)?.dataset
      .column as IdeaStatus | undefined
    if (over && over !== d.over) {
      d.over = over
      setDragging({ id: d.id, over })
    }
    // Near the edges of a scrolling board (phones), scroll towards the finger.
    const box = scroller.current?.getBoundingClientRect()
    if (box && scroller.current!.scrollWidth > box.width) {
      if (e.clientX < box.left + 40) scroller.current!.scrollLeft -= 14
      else if (e.clientX > box.right - 40) scroller.current!.scrollLeft += 14
    }
  }

  function onUp(e: PointerEvent) {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    if (d.started && d.over) {
      const idea = ops.ideas.find((i) => i.id === d.id)
      if (idea) ops.changeStatus(idea, d.over)
    }
    cleanup()
    // The click that follows a drag must not open the card.
    window.setTimeout(() => (suppressClick.current = false), 0)
  }

  function onCancel() {
    cleanup()
    suppressClick.current = false
  }

  function onPointerDown(e: React.PointerEvent, idea: Idea) {
    if (e.button !== 0 || lifted) return
    if ((e.target as HTMLElement).closest("button")) return
    cleanup()
    const d: Drag = {
      id: idea.id,
      pointerId: e.pointerId,
      pointer: e.pointerType as Drag["pointer"],
      x0: e.clientX,
      y0: e.clientY,
      t0: e.timeStamp,
      started: false,
      ghost: null,
      dx: 0,
      dy: 0,
      over: null,
      off: () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
        window.removeEventListener("touchmove", blockScroll)
      },
    }
    drag.current = d
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    window.addEventListener("touchmove", blockScroll, { passive: false })
    if (d.pointer !== "mouse") {
      // Holding still picks the card up even if the finger never moves.
      window.setTimeout(() => {
        if (drag.current === d && !d.started) begin(d)
      }, 300)
    }
  }

  useEffect(() => () => cleanup(), [])

  function onCardKey(e: ReactKeyboardEvent, idea: Idea) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (!lifted) {
      if (e.key === " ") {
        e.preventDefault()
        setLifted({ id: idea.id, from: idea.status, to: idea.status })
        setAnnounce(`Picked up “${idea.title}” in ${ideaStatusLabels[idea.status]}. Left and right arrows choose a column, Space drops, Escape cancels.`)
      }
      return
    }
    if (lifted.id !== idea.id) return
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault()
      const to = neighbourStatus(lifted.to, e.key === "ArrowLeft" ? -1 : 1)
      setLifted({ ...lifted, to })
      refocus.current = idea.id
      setAnnounce(ideaStatusLabels[to])
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault()
      const original = ops.ideas.find((i) => i.id === lifted.id)
      setLifted(null)
      refocus.current = idea.id
      if (original && lifted.to !== original.status) {
        ops.changeStatus(original, lifted.to)
        setAnnounce(`Dropped in ${ideaStatusLabels[lifted.to]}.`)
      } else setAnnounce("Dropped where it was.")
    } else if (e.key === "Escape") {
      e.preventDefault()
      setLifted(null)
      refocus.current = idea.id
      setAnnounce("Cancelled.")
    }
  }

  return (
    <div className="grid gap-2">
      <div
        ref={scroller}
        className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 lg:mx-0 lg:grid lg:snap-none lg:grid-cols-5 lg:overflow-visible lg:px-0"
      >
        {ideaStatuses.map((status) => {
          const list = board[status]
          const active = (dragging?.over === status && dragging) || (lifted?.to === status && lifted)
          return (
            <section
              key={status}
              data-column={status}
              aria-labelledby={`col-${status}`}
              className={cn(
                "glass grid w-[78vw] max-w-72 shrink-0 snap-start content-start gap-2 rounded-xl p-2 transition-[box-shadow,background-color] duration-150 lg:w-auto lg:max-w-none",
                active && "bg-secondary ring-2 ring-accent-500/60",
              )}
            >
              <header className="flex items-center gap-2 px-1.5 pt-1">
                <span aria-hidden className={cn("size-2 rounded-full", columnTone[status])} />
                <h3 id={`col-${status}`} className="text-eyebrow text-muted-foreground">
                  {ideaStatusLabels[status]}
                </h3>
                <span className="text-caption ml-auto text-muted-foreground tabular-nums">{list.length}</span>
              </header>
              <ul className="grid min-h-16 content-start gap-2">
                {list.map((idea) => {
                  const isDragged = dragging?.id === idea.id
                  const isLifted = lifted?.id === idea.id
                  return (
                    <li
                      key={idea.id}
                      data-card-id={idea.id}
                      onPointerDown={(e) => onPointerDown(e, idea)}
                      onClickCapture={(e) => {
                        if (suppressClick.current) {
                          e.preventDefault()
                          e.stopPropagation()
                        }
                      }}
                      onContextMenu={(e) => drag.current?.started && e.preventDefault()}
                      className={cn(
                        "group relative cursor-grab touch-manipulation rounded-lg border border-hairline bg-popover shadow-(--shadow-chip) select-none [-webkit-touch-callout:none] active:cursor-grabbing",
                        isDragged && "opacity-40",
                        isLifted && "ring-2 ring-accent-500 shadow-(--shadow-glass-lg)",
                      )}
                    >
                      <Link
                        href={`/app/ideas/${idea.id}`}
                        transitionTypes={NAV_FORWARD}
                        draggable={false}
                        onKeyDown={(e) => onCardKey(e, idea)}
                        aria-describedby="board-help"
                        className="grid gap-1.5 rounded-lg p-2.5 pr-8 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className={cn("text-body-strong text-pretty", idea.status === "dropped" && "text-muted-foreground line-through")}>
                          {idea.title}
                        </span>
                        {(idea.tags.length > 0 || idea.isPublic) && (
                          <span className="text-caption flex flex-wrap items-center gap-1 text-muted-foreground">
                            {idea.isPublic && <Eye className="size-3 text-text-accent" aria-label="Public" />}
                            {idea.tags.map((t) => (
                              <span key={t} className="rounded-md bg-track px-1.5 py-px">
                                {t}
                              </span>
                            ))}
                          </span>
                        )}
                      </Link>
                      <GripVertical aria-hidden className="absolute top-3 right-2 size-3.5 text-muted-foreground/50 pointer-coarse:hidden group-hover:opacity-0" />
                      <CardMenu idea={idea} ops={ops} />
                    </li>
                  )
                })}
                {list.length === 0 && (
                  <li
                    className={cn(
                      "text-caption grid h-16 place-items-center rounded-lg border border-dashed border-field-border text-muted-foreground",
                      active && "border-accent-500 text-text-accent",
                    )}
                  >
                    {dragging || lifted ? "Drop here" : "Empty"}
                  </li>
                )}
              </ul>
            </section>
          )
        })}
      </div>
      <p id="board-help" className="sr-only">
        Press Space to pick up the card, arrows to choose a column, Space to drop.
      </p>
      <p className="sr-only" role="status" aria-live="assertive">
        {announce}
      </p>
      <ShortcutHint
        items={[
          [["Space"], "pick up"],
          [["←", "→"], "column"],
          [["Space"], "drop"],
          [["Esc"], "cancel"],
        ]}
        touch="Hold a card, then drag it to another column. Swipe the board sideways to see every column."
      />
    </div>
  )
}

function CardMenu({ idea, ops }: { idea: Idea; ops: ReturnType<typeof useIdeas> }) {
  const router = useRouter()
  const actions = menuActions(idea, ops, () => router.push(`/app/ideas/${idea.id}`, { transitionTypes: NAV_FORWARD }))
  const regular = actions.filter((a) => a.tone !== "destructive")
  const destructive = actions.filter((a) => a.tone === "destructive")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for “${idea.title}”`}
            className="absolute top-1.5 right-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass glass-menu w-52">
        {regular.map((a) => (
          <DropdownMenuItem key={a.id} onClick={a.onSelect}>
            <a.icon />
            {a.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {destructive.map((a) => (
          <DropdownMenuItem key={a.id} variant="destructive" onClick={a.onSelect}>
            <a.icon />
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** First run: no ideas at all. */
export function IdeasEmpty() {
  return (
    <EmptyState
      icon={LightbulbDuo}
      title="Your idea backlog starts here"
      action={
        <Button size="lg" onClick={() => document.getElementById("quick-idea")?.focus()}>
          Write the first idea
        </Button>
      }
    >
      Type it in the field above and press Enter — sort it into exploring, building or shipped later.
    </EmptyState>
  )
}
