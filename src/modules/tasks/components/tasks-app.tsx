"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { NAV_TAB } from "@/components/motion"
import { Keyboard, MoreHorizontal, Pencil, Plus, Trash2 } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { addDays, formatIsoDate, parseIsoDate, wallClock } from "@/modules/calendar/lib/zoned"
import { dayHeading, dueLabel } from "../lib/format"
import { isTyping, useAfterG } from "@/lib/keys"
import { taskViews, UPCOMING_DAYS, viewLabels, type Task, type TasksData, type TaskView } from "../schema"
import { createList, deleteList, getTask, renameList, reorderTasks } from "../server-actions"
import { QuickAdd } from "./quick-add"
import { ScheduleOptions } from "./schedule-sheet"
import { Sheet } from "@/components/sheet"
import { TaskEditor } from "./task-editor"
import { TaskRow } from "./task-row"
import { useDragReorder } from "./use-drag-reorder"
import { useTaskMutations } from "./use-task-mutations"

type Section = {
  key: string
  title?: string
  meta?: string
  tone?: "warning"
  tasks: Task[]
  empty?: string
  /** Rows show their due date (sections that span several days). */
  showDue?: boolean
}

export function viewHref(view: TaskView, listId?: string | null) {
  if (view === "today") return "/app/tasks"
  if (view === "lists" && listId) return `/app/tasks?view=lists&list=${listId}`
  return `/app/tasks?view=${view}`
}

function sectionsFor(view: TaskView, tasks: Task[], today: string, locale: string, timezone: string): Section[] {
  switch (view) {
    case "today":
      return [
        { key: "overdue", title: "Overdue", tone: "warning", tasks: tasks.filter((t) => t.dueDate! < today) },
        { key: "today", title: "Today", tasks: tasks.filter((t) => t.dueDate === today) },
      ].filter((s) => s.tasks.length > 0) as Section[]
    case "upcoming": {
      const start = parseIsoDate(today)!
      const horizon = formatIsoDate(addDays(start, UPCOMING_DAYS))
      const days: Section[] = Array.from({ length: UPCOMING_DAYS }, (_, i) => {
        const iso = formatIsoDate(addDays(start, i + 1))
        const heading = dayHeading(iso, today, locale)
        return { key: iso, title: heading.title, meta: heading.meta, tasks: tasks.filter((t) => t.dueDate === iso), empty: "Nothing planned" }
      })
      // Past the week, and with no date at all: every open task has a place here.
      const later = tasks.filter((t) => t.dueDate !== null && t.dueDate > horizon)
      const undated = tasks.filter((t) => t.dueDate === null)
      return [
        ...days,
        ...(later.length ? [{ key: "later", title: "Later", tasks: later, showDue: true }] : []),
        ...(undated.length ? [{ key: "no-date", title: "No date", meta: "Whenever you get to them", tasks: undated }] : []),
      ]
    }
    case "lists":
      return [{ key: "list", tasks }]
    case "done": {
      const groups = new Map<string, Task[]>()
      for (const t of tasks) {
        const w = wallClock(new Date(t.doneAt!), timezone)
        const iso = formatIsoDate(w)
        groups.set(iso, [...(groups.get(iso) ?? []), t])
      }
      return [...groups].map(([iso, list]) => {
        const label = dueLabel(iso, today, locale)
        return { key: iso, title: label.tone === "today" || label.text === "Yesterday" ? label.text : dayHeading(iso, today, locale).meta, tasks: list }
      })
    }
  }
}

export function TasksApp({
  data,
  locale,
  timezone,
  openTaskId,
  openNew,
}: {
  data: TasksData
  locale: string
  timezone: string
  openTaskId: string | null
  openNew: boolean
}) {
  const router = useRouter()
  const { view, today } = data
  const m = useTaskMutations({ today, locale })
  const quickRef = useRef<HTMLInputElement>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [scheduling, setScheduling] = useState<Task | null>(null)
  const listNames = useMemo(() => data.lists.map((l) => l.name), [data.lists])
  const listName = (id: string | null) => (id ? (data.lists.find((l) => l.id === id)?.name ?? null) : null)

  // Lists view: a local order while dragging / after a move, until the server catches up.
  const [order, setOrder] = useState<string[] | null>(null)
  const [base, setBase] = useState(data.tasks)
  if (base !== data.tasks) {
    setBase(data.tasks)
    setOrder(null)
  }
  const visible = useMemo(() => {
    const list = m.apply(data.tasks)
    if (!order) return list
    const index = new Map(order.map((id, i) => [id, i]))
    return [...list].sort((a, b) => (index.get(a.id) ?? 1e9) - (index.get(b.id) ?? 1e9))
  }, [m, data.tasks, order])

  const sections = sectionsFor(view, visible, today, locale, timezone)
  const flat = sections.flatMap((s) => s.tasks)
  const reorderable = view === "lists"

  function commitOrder(ids: string[]) {
    setOrder(ids)
    void reorderTasks({ ids }).then((r) => {
      if (!r.ok) {
        setOrder(null)
        toast.error(r.error)
      }
    })
  }
  const drag = useDragReorder(flat.map((t) => t.id), commitOrder)

  // Deep links: ?task=<id> (⌘K search) opens its details; ?new=1 focuses quick add.
  const deepLink = `${openTaskId ?? ""}|${openNew}`
  const [lastDeepLink, setLastDeepLink] = useState("|false")
  if (lastDeepLink !== deepLink) {
    setLastDeepLink(deepLink)
    if (openTaskId) {
      const local = data.tasks.find((t) => t.id === openTaskId)
      if (local) setEditing(local)
    }
  }
  useEffect(() => {
    if (openNew) quickRef.current?.focus()
    if (openTaskId && !data.tasks.some((t) => t.id === openTaskId)) {
      void getTask({ id: openTaskId }).then((r) => {
        if (r.ok && r.value) setEditing(r.value)
        else if (r.ok) toast.error("That task no longer exists.")
      })
    }
    // Run when the link changes, not when the list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink])

  function neighbour(id: string) {
    const i = flat.findIndex((t) => t.id === id)
    return flat[i + 1]?.id ?? flat[i - 1]?.id ?? null
  }

  function complete(task: Task) {
    if (focusedId === task.id) setFocusedId(neighbour(task.id))
    void m.toggle(task)
  }

  function remove(task: Task) {
    if (focusedId === task.id) setFocusedId(neighbour(task.id))
    setEditing(null)
    m.remove(task)
  }

  function onAdded(task: Task) {
    const dueToday = task.dueDate !== null && task.dueDate <= today
    const inView =
      (view === "today" && dueToday) ||
      (view === "upcoming" && !dueToday) ||
      (view === "lists" && task.listId === data.selectedListId)
    if (inView) return
    // Undated tasks live at the end of Upcoming ("No date"), and in their list.
    const where = task.dueDate ? dueLabel(task.dueDate, today, locale).text : "No date"
    const target = dueToday ? viewHref("today") : viewHref("upcoming")
    toast.success(`Added · ${where}`, { action: { label: "Show", onClick: () => router.push(target) } })
  }

  // Keyboard: page keys never fire while typing, with a modifier, or right after the shell's `g`.
  const afterG = useAfterG()
  const keyState = useRef({ flat, focusedId, editing, scheduling, renamingId })
  useEffect(() => {
    keyState.current = { flat, focusedId, editing, scheduling, renamingId }
  })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = keyState.current
      if (e.metaKey || e.ctrlKey || isTyping(e.target) || afterG(e) || s.editing || s.scheduling || s.renamingId) return
      const index = s.flat.findIndex((t) => t.id === s.focusedId)
      const task = index >= 0 ? s.flat[index] : undefined
      const move = (delta: number) => {
        const next = s.flat[Math.max(0, Math.min(s.flat.length - 1, index < 0 ? 0 : index + delta))]
        if (next) setFocusedId(next.id)
      }
      if (e.altKey && task && reorderable && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault()
        const ids = s.flat.map((t) => t.id)
        const to = index + (e.key === "ArrowUp" ? -1 : 1)
        if (to < 0 || to >= ids.length) return
        ids.splice(to, 0, ...ids.splice(index, 1))
        commitOrder(ids)
        return
      }
      if (e.altKey) return
      switch (e.key) {
        case "n":
          e.preventDefault()
          quickRef.current?.focus()
          return
        case "ArrowDown":
        case "j":
          e.preventDefault()
          move(1)
          return
        case "ArrowUp":
        case "k":
          e.preventDefault()
          move(-1)
          return
        case "Escape":
          setFocusedId(null)
          ;(document.activeElement as HTMLElement | null)?.blur()
          return
      }
      if (!task) return
      switch (e.key) {
        case "x":
          e.preventDefault()
          complete(task)
          return
        case "t":
          e.preventDefault()
          void m.schedule(task, today)
          return
        case "s":
          e.preventDefault()
          setScheduling(task)
          return
        case "Enter":
          e.preventDefault()
          setRenamingId(task.id)
          return
        case "e":
        case "i":
          e.preventDefault()
          setEditing(task)
          return
        case "Backspace":
        case "Delete":
          e.preventDefault()
          remove(task)
          return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const total = view === "today" ? data.counts.overdue + data.counts.today : view === "upcoming" ? data.counts.upcoming : null

  return (
    <div className="grid gap-3">
      <ViewTabs data={data} />
      <QuickAdd
        ref={quickRef}
        today={today}
        locale={locale}
        listNames={listNames}
        listId={view === "lists" ? data.selectedListId : null}
        dueToday={view === "today"}
        placeholder={
          view === "lists" && data.selectedListId
            ? `Add to ${listName(data.selectedListId)} — try “fri !high”`
            : view === "today"
              ? "Add for today — try “10:00 !high #List”"
              : undefined
        }
        onAdded={onAdded}
      />

      <div className={cn(view === "lists" && "grid gap-3 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start")}>
        {view === "lists" && <ListsNav data={data} />}
        <div className="grid gap-3">
          {view === "lists" && <ListHeader data={data} />}
          {flat.length === 0 && view !== "upcoming" ? (
            <EmptyState view={view} data={data} />
          ) : (
            sections.map((section) => {
              // The last task leaving a section takes the heading (and the gap after
              // it) along, in the same motion, instead of the heading snapping away after.
              const leaving = section.tasks.length > 0 && section.tasks.every((t) => m.stateOf(t.id) === "leaving")
              return (
                <section
                  key={section.key}
                  aria-label={section.title ?? "Tasks"}
                  className={cn(
                    "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none",
                    leaving ? "-mb-3 grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
                  )}
                >
                  <div className={cn("grid min-h-0 gap-1.5", leaving && "overflow-hidden")}>
                    {section.title && (
                      <h2 className="flex items-baseline gap-2 px-1">
                        <span className={cn("text-heading", section.tone === "warning" && "text-warning-text")}>{section.title}</span>
                        {section.meta && <span className="text-meta text-muted-foreground">{section.meta}</span>}
                        {section.tasks.length > 0 && (
                          <span className="text-caption ml-auto text-muted-foreground tabular-nums">{section.tasks.length}</span>
                        )}
                      </h2>
                    )}
                    {section.tasks.length === 0 ? (
                      <p className="text-caption border-t border-hairline px-1 pt-2 text-muted-foreground/80">{section.empty}</p>
                    ) : (
                      <div role="list" className="glass divide-y divide-hairline overflow-hidden rounded-xl" ref={reorderable ? drag.containerRef : undefined}>
                        {section.tasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            state={m.stateOf(task.id)}
                            today={today}
                            locale={locale}
                            listName={view === "lists" ? null : listName(task.listId)}
                            showDue={view === "lists" || section.showDue === true || (view === "today" && task.dueDate !== today)}
                            focused={focusedId === task.id}
                            editing={renamingId === task.id}
                            onFocusRow={() => setFocusedId(task.id)}
                            onToggle={() => complete(task)}
                            onOpen={() => {
                              setFocusedId(task.id)
                              setEditing(task)
                            }}
                            onSchedule={() => setScheduling(task)}
                            onStartRename={() => setRenamingId(task.id)}
                            onRename={(title) => {
                              setRenamingId(null)
                              if (title) void m.save(task, { title })
                            }}
                            grip={reorderable ? { onPointerDown: (e) => drag.start(task.id, e), dragging: drag.draggingId === task.id } : undefined}
                            style={reorderable ? drag.styleFor(task.id) : undefined}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )
            })
          )}
          {total !== null && total > 0 && view === "today" && data.counts.overdue > 0 && (
            <p className="text-caption px-1 text-muted-foreground">Swipe left or press S on a task to reschedule it.</p>
          )}
          <ShortcutHint reorderable={reorderable} />
        </div>
      </div>

      <TaskEditor
        task={editing}
        lists={data.lists}
        today={today}
        locale={locale}
        onClose={() => setEditing(null)}
        onSave={(task, patch) => void m.save(task, patch)}
        onDelete={remove}
      />
      <Sheet
        open={scheduling !== null}
        onOpenChange={(open) => !open && setScheduling(null)}
        title="Schedule"
        description={scheduling?.title}
      >
        {scheduling && (
          <ScheduleOptions
            task={scheduling}
            today={today}
            locale={locale}
            onPick={(date) => {
              const task = scheduling
              setScheduling(null)
              void m.schedule(task, date)
            }}
          />
        )}
      </Sheet>
    </div>
  )
}

function ViewTabs({ data }: { data: TasksData }) {
  const counts: Partial<Record<TaskView, number>> = {
    today: data.counts.overdue + data.counts.today,
    upcoming: data.counts.upcoming,
  }
  return (
    <nav aria-label="Task views" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="segmented">
        {taskViews.map((v) => {
          const active = v === data.view
          return (
            <li key={v}>
              <Link
                href={viewHref(v)}
                transitionTypes={NAV_TAB}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "text-small flex h-8 items-center gap-1.5 rounded-lg px-3 whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-md:h-9",
                  active && "segment-active text-foreground",
                )}
              >
                {viewLabels[v]}
                {counts[v] ? <span className="text-caption tabular-nums opacity-70">{counts[v]}</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function ListsNav({ data }: { data: TasksData }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const items: { id: string | null; name: string; count: number }[] = [
    { id: null, name: "No list", count: data.unlistedCount },
    ...data.lists.map((l) => ({ id: l.id, name: l.name, count: l.openCount })),
  ]

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const result = await createList({ name })
    if (!result.ok) return setError(result.error)
    setName("")
    setAdding(false)
    setError(null)
    router.push(viewHref("lists", result.value.id), { scroll: false })
  }

  return (
    <nav aria-label="Lists" className="grid gap-2 md:glass md:rounded-xl md:p-2">
      <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:gap-0.5 md:overflow-visible md:p-0">
        {items.map((item) => {
          const active = item.id === data.selectedListId
          return (
            <li key={item.id ?? "none"} className="shrink-0">
              <Link
                href={viewHref("lists", item.id)}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-body flex h-9 items-center gap-2 rounded-lg px-3 whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 max-md:glass md:h-8 md:px-2.5",
                  active ? "bg-accent-500/12 text-text-accent max-md:bg-primary max-md:text-primary-foreground" : "hover:bg-track",
                  item.id === null && !active && "text-muted-foreground",
                )}
              >
                <span className="min-w-0 truncate">{item.name}</span>
                {item.count > 0 && <span className="text-caption ml-auto pl-1 tabular-nums opacity-70">{item.count}</span>}
              </Link>
            </li>
          )
        })}
        <li className="shrink-0 md:mt-1 md:border-t md:border-hairline md:pt-1">
          {adding ? (
            <form onSubmit={add} className="grid gap-1">
              <label htmlFor="new-list" className="sr-only">
                List name
              </label>
              <input
                id="new-list"
                autoFocus
                value={name}
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                onBlur={() => !name.trim() && setAdding(false)}
                placeholder="e.g. University"
                className="text-body h-9 w-44 rounded-lg border border-accent-500 bg-field px-2.5 outline-none ring-3 ring-accent-500/20 md:h-8 md:w-full"
              />
              {error && <p className="text-caption text-destructive">{error}</p>}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-body flex h-9 items-center gap-2 rounded-lg px-3 whitespace-nowrap text-text-accent outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:w-full md:px-2.5"
            >
              <Plus className="size-4" />
              New list
            </button>
          )}
        </li>
      </ul>
    </nav>
  )
}

function ListHeader({ data }: { data: TasksData }) {
  const router = useRouter()
  const list = data.lists.find((l) => l.id === data.selectedListId)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(list?.name ?? "")
  const [hidden, setHidden] = useState(false)
  if (!list || hidden) {
    return (
      <div className="px-1">
        <h2 className="text-card-title">No list</h2>
        <p className="text-caption text-muted-foreground">Tasks you haven’t filed anywhere.</p>
      </div>
    )
  }

  async function rename(e?: React.FormEvent) {
    e?.preventDefault()
    setRenaming(false)
    if (!list || !name.trim() || name.trim() === list.name) return setName(list?.name ?? "")
    const result = await renameList({ id: list.id, name: name.trim() })
    if (!result.ok) {
      setName(list.name)
      toast.error(result.error)
    }
  }

  return (
    <div className="flex items-center gap-2 px-1">
      {renaming ? (
        <form onSubmit={rename} className="flex-1">
          <label htmlFor="rename-list" className="sr-only">
            List name
          </label>
          <input
            id="rename-list"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setName(list.name)
                setRenaming(false)
              }
            }}
            className="text-card-title h-9 w-full rounded-lg border border-accent-500 bg-field px-2 font-display outline-none ring-3 ring-accent-500/20"
          />
        </form>
      ) : (
        <h2 className="text-card-title min-w-0 flex-1 truncate" onDoubleClick={() => setRenaming(true)}>
          {list.name}
        </h2>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={`Options for ${list.name}`}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="glass glass-menu w-44">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              removeWithUndo({
                message: `List deleted — its ${list.openCount === 1 ? "task moved" : "tasks moved"} to No list`,
                hide: () => setHidden(true),
                restore: () => setHidden(false),
                commit: async () => {
                  const result = await deleteList({ id: list.id })
                  if (result.ok) router.push(viewHref("lists"), { scroll: false })
                  return result
                },
              })
            }
          >
            <Trash2 />
            Delete list
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function EmptyState({ view, data }: { view: TaskView; data: TasksData }) {
  const copy: Record<TaskView, { title: string; body: ReactNode }> = {
    today: {
      title: "All clear for today",
      body: (
        <>
          Nothing overdue, nothing due.{" "}
          {data.counts.upcoming > 0 ? (
            <Link href={viewHref("upcoming")} className="text-text-accent underline-offset-4 hover:underline">
              {data.counts.upcoming} coming up this week
            </Link>
          ) : (
            "Add something above — “tomorrow”, “fri 10:00” and “!high” all work."
          )}
        </>
      ),
    },
    upcoming: { title: "", body: null },
    lists: {
      title: "Nothing here yet",
      body: "Add a task above and it lands in this list. Drag the handle to put things in order.",
    },
    done: { title: "Nothing completed yet", body: "Tick a task and it shows up here, ready to restore if you change your mind." },
  }
  return (
    <div className="glass grid gap-1 rounded-xl p-6">
      <p className="text-card-title">{copy[view].title}</p>
      <p className="text-meta max-w-prose text-muted-foreground">{copy[view].body}</p>
    </div>
  )
}

function ShortcutHint({ reorderable }: { reorderable: boolean }) {
  const keys: [string, string][] = [
    ["N", "new"],
    ["↑↓", "move"],
    ["X", "complete"],
    ["T", "today"],
    ["S", "schedule"],
    ["↵", "rename"],
    ["E", "details"],
  ]
  if (reorderable) keys.push(["⌥↑↓", "reorder"])
  return (
    <p className="text-caption hidden flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-muted-foreground md:flex" aria-label="Keyboard shortcuts">
      <Keyboard className="size-3.5" aria-hidden />
      {keys.map(([k, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <Kbd>{k}</Kbd>
          {label}
        </span>
      ))}
    </p>
  )
}
