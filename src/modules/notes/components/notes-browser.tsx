"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, FolderOpen, ListChecks, Pin, PinOff, Plus, SearchDuo, Trash2, CheckSquare } from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { pendingRemovals, usePendingRemovals } from "@/components/list/pending"
import { RowContextMenu } from "@/components/list/row-menu"
import { BulkBar, SelectButton, SelectCheck, useSelection, type Selection } from "@/components/list/selection"
import { EmptyState, ShortcutHint } from "@/components/list/shortcut-hint"
import { SwipeRow, type RowAction } from "@/components/list/swipe-row"
import { useListKeyboard } from "@/components/list/use-list-keyboard"
import { Button, buttonVariants } from "@/components/ui/button"
import { removeWithUndo } from "@/lib/undo-toast"
import { formatRelative } from "@/lib/time"
import { cn } from "@/lib/utils"
import { taskProgress } from "../lib/checklist"
import { excerpt, type Note } from "../schema"
import { deleteNotes, pinNotes } from "../server-actions"
import { NotesSearch } from "./notes-search"

const COLLAPSE_KEY = "notes:pinned-collapsed"

/**
 * The notes list: pinned on top (collapsible), then everything else. Swipe a
 * row right to pin, left to delete; right-click or long-press for the menu;
 * J/K, Enter, N, P, X and ⌫ on a keyboard. Deletes wait for their Undo.
 */
export function NotesBrowser({
  notes,
  query,
  locale,
  now,
}: {
  notes: Note[]
  query: string
  locale: string
  now: string
}) {
  const router = useRouter()
  const removed = usePendingRemovals()
  const [pinOverride, setPinOverride] = useState<Map<string, boolean>>(new Map())
  const [, startTransition] = useTransition()
  const [collapsed, setCollapsed] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const filter = useRef<HTMLInputElement>(null)
  const nowDate = new Date(now)

  useEffect(() => {
    try {
      // Restoring a saved preference after hydration; there is nothing to subscribe to.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true)
    } catch {}
  }, [])

  const visible = useMemo(
    () =>
      notes
        .filter((n) => !removed.has(n.id))
        .map((n) => (pinOverride.has(n.id) ? { ...n, pinned: pinOverride.get(n.id)! } : n)),
    [notes, removed, pinOverride],
  )
  const pinned = query ? [] : visible.filter((n) => n.pinned)
  const rest = query ? visible : visible.filter((n) => !n.pinned)
  const ordered = [...(collapsed ? [] : pinned), ...rest]
  const selection = useSelection(ordered.map((n) => n.id))
  const byId = new Map(visible.map((n) => [n.id, n]))

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
    } catch {}
  }

  function setPinned(ids: string[], value: boolean, undoable = true) {
    const before = new Map(ids.map((id) => [id, byId.get(id)?.pinned ?? false]))
    setPinOverride((prev) => {
      const next = new Map(prev)
      for (const id of ids) next.set(id, value)
      return next
    })
    startTransition(async () => {
      const result = await pinNotes({ ids, pinned: value })
      if (!result.ok) {
        setPinOverride((prev) => {
          const next = new Map(prev)
          for (const [id, was] of before) next.set(id, was)
          return next
        })
        return void toast.error(result.error)
      }
      if (!undoable) return
      const what = ids.length === 1 ? "Note" : `${ids.length} notes`
      toast.success(value ? `${what} pinned to Today` : `${what} unpinned`, {
        action: { label: "Undo", onClick: () => setPinned(ids, !value, false) },
      })
    })
  }

  function remove(ids: string[]) {
    if (!ids.length) return
    focusNeighbour(ids)
    selection.done()
    const single = ids.length === 1 ? byId.get(ids[0]!) : null
    removeWithUndo({
      message: single ? `“${single.title}” deleted` : `${ids.length} notes deleted`,
      hide: () => ids.forEach((id) => pendingRemovals.add(id)),
      restore: () => ids.forEach((id) => pendingRemovals.remove(id)),
      commit: () => deleteNotes({ ids }),
    })
  }

  /** Keeps the keyboard cursor in the list when its row disappears. */
  function focusNeighbour(ids: string[]) {
    const active = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-row-id]")
    if (!active || !ids.includes(active.dataset.rowId!)) return
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])
    const at = rows.indexOf(active)
    const next = rows.slice(at + 1).find((r) => !ids.includes(r.dataset.rowId!)) ??
      rows.slice(0, at).reverse().find((r) => !ids.includes(r.dataset.rowId!))
    requestAnimationFrame(() => next?.querySelector<HTMLElement>("[data-row-primary]")?.focus())
  }

  const targets = (id: string | null) => (selection.count ? [...selection.ids] : id ? [id] : [])

  useListKeyboard({
    container: list,
    filter,
    selection,
    handlers: {
      new: () => router.push("/app/notes/new"),
      open: (id) => id && router.push(`/app/notes/${id}`),
      edit: (id) => id && router.push(`/app/notes/${id}`),
      pin: (id) => {
        const ids = targets(id)
        if (ids.length) setPinned(ids, !ids.every((i) => byId.get(i)?.pinned))
      },
      delete: (id) => remove(targets(id)),
    },
  })

  function actionsFor(note: Note): RowAction[] {
    return [
      { id: "open", label: "Open", icon: FolderOpen, onSelect: () => router.push(`/app/notes/${note.id}`), shortcut: "↵" },
      {
        id: "pin",
        label: note.pinned ? "Unpin" : "Pin to Today",
        icon: note.pinned ? PinOff : Pin,
        tone: "warning",
        onSelect: () => setPinned([note.id], !note.pinned),
        shortcut: "P",
      },
      { id: "select", label: "Select", icon: CheckSquare, onSelect: () => selection.toggle(note.id), shortcut: "X" },
      { id: "delete", label: "Delete", icon: Trash2, tone: "destructive", onSelect: () => remove([note.id]), shortcut: "⌫" },
    ]
  }

  const selectedPinned = [...selection.ids].every((id) => byId.get(id)?.pinned)

  return (
    <div className="grid gap-4" ref={list}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <NotesSearch initialQuery={query} inputRef={filter} />
        </div>
        <SelectButton selection={selection} disabled={ordered.length === 0} />
      </div>

      {query && (
        <p className="text-meta text-muted-foreground" role="status">
          {visible.length === 0
            ? `Nothing matches “${query}”. Try fewer words.`
            : `${visible.length} ${visible.length === 1 ? "note matches" : "notes match"} “${query}”`}
        </p>
      )}
      {query && visible.length === 0 && (
        <EmptyState
          icon={SearchDuo}
          title="No notes found"
          action={
            <Link href="/app/notes/new" className={buttonVariants({ size: "lg" })}>
              <Plus />
              New note “{query}”
            </Link>
          }
        />
      )}

      {pinned.length > 0 && (
        <section className="grid gap-2" aria-labelledby="pinned-heading">
          <h2 id="pinned-heading">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls="pinned-list"
              className="text-eyebrow -mx-1 -my-1.5 flex items-center gap-1 rounded-md px-1 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronDown className={cn("size-3 transition-transform duration-200 motion-reduce:transition-none", collapsed && "-rotate-90")} />
              Pinned · {pinned.length}
            </button>
          </h2>
          {!collapsed && (
            <NoteRows
              id="pinned-list"
              notes={pinned}
              locale={locale}
              now={nowDate}
              selection={selection}
              actionsFor={actionsFor}
              onPin={(n) => setPinned([n.id], !n.pinned)}
              onDelete={(n) => remove([n.id])}
            />
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section className="grid gap-2" aria-labelledby="all-heading">
          {pinned.length > 0 && (
            <h2 id="all-heading" className="text-eyebrow text-muted-foreground">
              Everything else · {rest.length}
            </h2>
          )}
          <NoteRows
            notes={rest}
            locale={locale}
            now={nowDate}
            query={query || undefined}
            selection={selection}
            actionsFor={actionsFor}
            onPin={(n) => setPinned([n.id], !n.pinned)}
            onDelete={(n) => remove([n.id])}
          />
        </section>
      )}

      {ordered.length > 0 && (
        <ShortcutHint
          items={[
            [["J", "K"], "move"],
            [["↵"], "open"],
            [["N"], "new"],
            [["P"], "pin"],
            [["X"], "select"],
            [["⌫"], "delete"],
            [["/"], "filter"],
          ]}
          touch="Swipe a note right to pin it, left to delete. Hold for more."
        />
      )}

      <BulkBar selection={selection} noun={["note", "notes"]} total={ordered.length}>
        <Button
          variant="ghost"
          size="lg"
          disabled={!selection.count}
          onClick={() => {
            setPinned([...selection.ids], !selectedPinned)
            selection.done()
          }}
        >
          {selectedPinned && selection.count ? <PinOff /> : <Pin />}
          <span className="max-sm:sr-only">{selectedPinned && selection.count ? "Unpin" : "Pin"}</span>
        </Button>
        <Button variant="destructive" size="lg" disabled={!selection.count} onClick={() => remove([...selection.ids])}>
          <Trash2 />
          Delete
        </Button>
      </BulkBar>
    </div>
  )
}

function NoteRows({
  id,
  notes,
  locale,
  now,
  query,
  selection,
  actionsFor,
  onPin,
  onDelete,
}: {
  id?: string
  notes: Note[]
  locale: string
  now: Date
  query?: string
  selection: Selection
  actionsFor: (note: Note) => RowAction[]
  onPin: (note: Note) => void
  onDelete: (note: Note) => void
}) {
  return (
    <ul id={id} className="glass divide-y divide-hairline overflow-hidden rounded-xl">
      {notes.map((note) => {
        const preview = excerpt(note.body, query)
        const progress = taskProgress(note.body)
        const actions = actionsFor(note)
        const checked = selection.has(note.id)
        return (
          <li key={note.id} data-row-id={note.id}>
            <SwipeRow
              disabled={selection.active}
              leading={{ ...actions[1]!, label: note.pinned ? "Unpin" : "Pin", onSelect: () => onPin(note) }}
              trailing={[{ ...actions[3]!, onSelect: () => onDelete(note) }]}
            >
              <RowContextMenu actions={actions} label={note.title}>
                <Link
                  data-row-primary
                  href={`/app/notes/${note.id}`}
                  transitionTypes={NAV_FORWARD}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault()
                      selection.extend(note.id)
                    } else if (selection.active) {
                      e.preventDefault()
                      selection.toggle(note.id)
                    }
                  }}
                  aria-describedby={checked ? `sel-${note.id}` : undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none hover:bg-white/40 focus-visible:bg-white/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset dark:hover:bg-white/5 dark:focus-visible:bg-white/5",
                    checked && "bg-secondary hover:bg-secondary",
                  )}
                >
                  {selection.active && <SelectCheck checked={checked} />}
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-body-strong flex items-center gap-1.5">
                      {note.pinned && <Pin className="size-3.5 shrink-0 text-text-accent" aria-label="Pinned" />}
                      <span className="truncate">{note.title}</span>
                    </span>
                    {preview && <span className="text-meta truncate text-muted-foreground">{preview}</span>}
                  </span>
                  <span className="grid shrink-0 justify-items-end gap-0.5">
                    <time dateTime={note.updated_at} className="text-caption text-muted-foreground tabular-nums">
                      {formatRelative(new Date(note.updated_at), now, locale)}
                    </time>
                    {progress && (
                      <span
                        className={cn(
                          "text-caption inline-flex items-center gap-1 tabular-nums",
                          progress.done === progress.total ? "text-text-accent" : "text-muted-foreground",
                        )}
                        aria-label={`${progress.done} of ${progress.total} done`}
                      >
                        <ListChecks className="size-3.5" />
                        {progress.done}/{progress.total}
                      </span>
                    )}
                  </span>
                  {checked && (
                    <span id={`sel-${note.id}`} className="sr-only">
                      Selected
                    </span>
                  )}
                </Link>
              </RowContextMenu>
            </SwipeRow>
          </li>
        )
      })}
    </ul>
  )
}
