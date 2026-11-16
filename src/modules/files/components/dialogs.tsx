"use client"

import { useMemo, useState, useTransition, type FormEvent } from "react"
import { Folder, House } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Folder as FolderRow } from "../schema"

/** A one-field dialog: new folder, rename. Shows the server's error inline. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  initial = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  placeholder?: string
  initial?: string
  submitLabel: string
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass glass-menu">
        {/* Keyed so each opening starts from `initial`. */}
        {open && (
          <NameForm
            key={initial}
            title={title}
            label={label}
            placeholder={placeholder}
            initial={initial}
            submitLabel={submitLabel}
            onSubmit={onSubmit}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  title,
  label,
  placeholder,
  initial,
  submitLabel,
  onSubmit,
  onDone,
}: {
  title: string
  label: string
  placeholder?: string
  initial: string
  submitLabel: string
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>
  onDone: () => void
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await onSubmit(value.trim())
      if (result.ok) onDone()
      else setError(result.error ?? "That didn't work. Try again.")
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-card-title">{title}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="name-field" className="text-meta text-muted-foreground">
          {label}
        </label>
        <Input
          id="name-field"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          placeholder={placeholder}
          autoFocus
          autoComplete="off"
          maxLength={255}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "name-error" : undefined}
        />
        {error && (
          <p id="name-error" className="text-caption rounded-lg bg-error-surface px-2 py-1.5 text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter className="bg-transparent">
        <Button type="submit" disabled={pending || !value.trim()}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

type TreeRow = { folder: FolderRow; depth: number }

function flatten(folders: FolderRow[]): TreeRow[] {
  const children = new Map<string | null, FolderRow[]>()
  for (const f of folders) {
    const list = children.get(f.parentId) ?? []
    list.push(f)
    children.set(f.parentId, list)
  }
  const out: TreeRow[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      out.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Pick a destination folder. A folder being moved can't go into itself or below. */
export function MoveDialog({
  open,
  onOpenChange,
  itemName,
  movingFolderId,
  currentFolderId,
  folders,
  onMove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemName: string
  movingFolderId: string | null
  currentFolderId: string | null
  folders: FolderRow[]
  onMove: (folderId: string | null) => Promise<{ ok: boolean; error?: string }>
}) {
  const rows = useMemo(() => flatten(folders), [folders])
  const blocked = useMemo(() => {
    const set = new Set<string>()
    if (!movingFolderId) return set
    set.add(movingFolderId)
    let grew = true
    while (grew) {
      grew = false
      for (const f of folders) {
        if (f.parentId && set.has(f.parentId) && !set.has(f.id)) {
          set.add(f.id)
          grew = true
        }
      }
    }
    return set
  }, [folders, movingFolderId])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function choose(folderId: string | null) {
    start(async () => {
      const result = await onMove(folderId)
      if (result.ok) {
        setError(null)
        onOpenChange(false)
      } else setError(result.error ?? "It wasn't moved. Try again.")
    })
  }

  const option = (id: string | null, label: string, depth: number, disabled: boolean) => (
    <li key={id ?? "root"}>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => choose(id)}
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
        className={cn(
          "text-meta flex w-full items-center gap-2 rounded-lg py-2 pr-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {id ? <Folder className="size-4 shrink-0 text-text-accent" /> : <House className="size-4 shrink-0 text-text-accent" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {id === currentFolderId && <span className="text-caption text-muted-foreground">Here now</span>}
      </button>
    </li>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass glass-menu">
        <DialogHeader>
          <DialogTitle className="text-card-title">Move “{itemName}”</DialogTitle>
          <DialogDescription>Choose where it goes.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 grid max-h-[50vh] gap-0.5 overflow-y-auto">
          {option(null, "Top level", 0, currentFolderId === null)}
          {rows.map(({ folder, depth }) =>
            option(folder.id, folder.name, depth + 1, blocked.has(folder.id) || folder.id === currentFolderId),
          )}
        </ul>
        {error && <p className="text-caption rounded-lg bg-error-surface px-2 py-1.5 text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
