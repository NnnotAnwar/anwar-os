"use client"

import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Check, Plus, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { categoryColorNames, colorClass, colorLabels } from "../lib/colors"
import type { Category, CategoryKind } from "../schema"
import { archiveCategory, createCategory, deleteCategory, updateCategory } from "../server-actions"
import { CategoryDot, Field, FormError, Sheet, selectClass } from "./bits"

type Editing = { mode: "create"; kind: CategoryKind; parentId: string | null } | { mode: "edit"; category: Category } | null

export function CategoriesBoard({ categories }: { categories: Category[] }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [, start] = useTransition()
  const shown = categories.filter((c) => !hidden.has(c.id))

  function toggleArchive(category: Category) {
    const value = !category.archived
    setEditing(null)
    start(async () => {
      const result = await archiveCategory({ id: category.id, archived: value })
      if (!result.ok) return void toast.error(result.error)
      toast.success(value ? `${category.name} archived` : `${category.name} is back`, {
        action: { label: "Undo", onClick: () => start(() => void archiveCategory({ id: category.id, archived: !value })) },
      })
    })
  }

  function remove(category: Category) {
    setEditing(null)
    removeWithUndo({
      message:
        category.transactionCount > 0
          ? `${category.name} deleted · ${category.transactionCount} transactions now uncategorised`
          : `${category.name} deleted`,
      hide: () => setHidden((prev) => new Set(prev).add(category.id)),
      restore: () =>
        setHidden((prev) => {
          const next = new Set(prev)
          next.delete(category.id)
          return next
        }),
      commit: () => deleteCategory({ id: category.id }),
    })
  }

  const section = (kind: CategoryKind, title: string) => {
    const parents = shown.filter((c) => c.kind === kind && !c.archived && !c.parentId)
    const orphans = shown.filter((c) => c.kind === kind && !c.archived && c.parentId && !parents.some((p) => p.id === c.parentId))
    return (
      <section aria-labelledby={`cat-${kind}`} className="grid content-start gap-2">
        <header className="flex items-center justify-between px-1">
          <h2 id={`cat-${kind}`} className="text-eyebrow text-text-accent">
            {title}
          </h2>
          <Button variant="ghost" size="sm" className="h-9" onClick={() => setEditing({ mode: "create", kind, parentId: null })}>
            <Plus />
            Add
          </Button>
        </header>
        <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
          {[...parents, ...orphans].map((p) => (
            <li key={p.id}>
              <Row category={p} onEdit={() => setEditing({ mode: "edit", category: p })} />
              {shown
                .filter((c) => c.parentId === p.id && !c.archived)
                .map((child) => (
                  <Row key={child.id} category={child} child onEdit={() => setEditing({ mode: "edit", category: child })} />
                ))}
            </li>
          ))}
          {parents.length + orphans.length === 0 && <li className="text-meta px-4 py-3 text-muted-foreground">No categories yet.</li>}
        </ul>
      </section>
    )
  }

  const archived = shown.filter((c) => c.archived)
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {section("expense", "Spending")}
        {section("income", "Income")}
      </div>
      {archived.length > 0 && (
        <section aria-labelledby="cat-archived" className="grid gap-2">
          <h2 id="cat-archived" className="text-eyebrow px-1 text-muted-foreground">
            Archived
          </h2>
          <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-2 pr-2">
                <div className="min-w-0 flex-1">
                  <Row category={c} onEdit={() => setEditing({ mode: "edit", category: c })} />
                </div>
                <Button variant="ghost" size="sm" className="h-9" onClick={() => toggleArchive(c)}>
                  Unarchive
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === "edit" ? "Edit category" : "New category"}
        description={editing?.mode === "edit" ? `${editing.category.transactionCount} transactions use it.` : undefined}
      >
        {editing && (
          <CategoryForm
            key={editing.mode === "edit" ? editing.category.id : `new-${editing.kind}`}
            editing={editing}
            categories={categories}
            onDone={() => setEditing(null)}
            onArchive={toggleArchive}
            onDelete={remove}
          />
        )}
      </Sheet>
    </div>
  )
}

function Row({ category, child, onEdit }: { category: Category; child?: boolean; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-track focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        child && "pl-9",
      )}
      aria-label={`Edit ${category.name}`}
    >
      <CategoryDot color={category.color} className={child ? "size-2" : "size-3"} />
      <span className={cn("min-w-0 flex-1 truncate", child ? "text-body" : "text-body-strong")}>{category.name}</span>
      <span className="text-caption text-muted-foreground tabular-nums">{category.transactionCount || ""}</span>
    </button>
  )
}

function CategoryForm({
  editing,
  categories,
  onDone,
  onArchive,
  onDelete,
}: {
  editing: NonNullable<Editing>
  categories: Category[]
  onDone: () => void
  onArchive: (c: Category) => void
  onDelete: (c: Category) => void
}) {
  const current = editing.mode === "edit" ? editing.category : null
  const [name, setName] = useState(current?.name ?? "")
  const [kind, setKind] = useState<CategoryKind>(current?.kind ?? (editing.mode === "create" ? editing.kind : "expense"))
  const [parentId, setParentId] = useState(current?.parentId ?? (editing.mode === "create" ? editing.parentId : null) ?? "")
  const [color, setColor] = useState(current?.color ?? "accent-500")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const hasChildren = current ? categories.some((c) => c.parentId === current.id) : false
  const parents = categories.filter((c) => c.kind === kind && !c.parentId && !c.archived && c.id !== current?.id)

  function submit(e: FormEvent) {
    e.preventDefault()
    const payload = { name, kind, parentId: parentId || null, color }
    start(async () => {
      const result = current ? await updateCategory({ id: current.id, ...payload }) : await createCategory(payload)
      if (!result.ok) return setError(result.error)
      toast.success(current ? "Category saved" : "Category added")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name" htmlFor="cat-name">
        <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus={!current} autoComplete="off" placeholder="e.g. Groceries" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" htmlFor="cat-kind">
          <select
            id="cat-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as CategoryKind)
              setParentId("")
            }}
            className={selectClass}
            disabled={hasChildren}
          >
            <option value="expense">Spending</option>
            <option value="income">Income</option>
          </select>
        </Field>
        <Field label="Inside" htmlFor="cat-parent" hint={hasChildren ? "Has subcategories, so it stays top-level." : undefined}>
          <select id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} className={selectClass} disabled={hasChildren}>
            <option value="">Top level</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="text-small mb-1.5 text-muted-foreground">Colour</legend>
        <div className="flex flex-wrap gap-1.5">
          {categoryColorNames.map((token) => (
            <label key={token} className="relative cursor-pointer" title={colorLabels[token]}>
              <input type="radio" name="cat-color" value={token} checked={color === token} onChange={() => setColor(token)} className="peer sr-only" />
              <span className="sr-only">{colorLabels[token]}</span>
              <span
                aria-hidden
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg ring-1 ring-field-border peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                  color === token && "ring-2 ring-foreground/60",
                )}
              >
                <span className={cn("flex size-5 items-center justify-center rounded-full text-white [&_svg]:size-3", colorClass(token))}>
                  {color === token && <Check />}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        {current && (
          <>
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => onDelete(current)}>
              <Trash2 />
              Delete
            </Button>
            {!current.archived && (
              <Button type="button" variant="ghost" onClick={() => onArchive(current)}>
                Archive
              </Button>
            )}
          </>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {current ? "Save" : "Add category"}
          </Button>
        </div>
      </div>
    </form>
  )
}
