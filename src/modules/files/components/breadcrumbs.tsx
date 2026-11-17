"use client"

import { Fragment, useState, type DragEvent } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ChevronRightIcon, MoreHorizontal } from "@/components/icons"
import { NAV_BACK } from "@/components/motion"
import { pendingRemovals } from "@/components/list/pending"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { folderHref } from "../lib/links"
import type { Folder } from "../schema"
import { moveItem } from "../server-actions"

const DRAG_TYPE = "application/x-anwar-files"

type Crumb = { id: string | null; name: string }

/**
 * All files › Taxes › 2026. The last crumb is the current page unless
 * `current` is given. On phones the middle collapses into "…" (a menu), so the
 * trail never wraps. Crumbs accept rows dragged from the list: drop to move up.
 */
export function Breadcrumbs({ path, current }: { path: Folder[]; current?: string }) {
  const crumbs: Crumb[] = [{ id: null, name: "All files" }, ...path.map((f) => ({ id: f.id as string | null, name: f.name }))]
  const here = path.at(-1)?.id ?? null
  const [over, setOver] = useState<string | null | undefined>(undefined)

  // Collapsible on phones: first crumb, "…", then the last two.
  const hidden = crumbs.length > 3 ? crumbs.slice(1, -2) : []

  async function drop(e: DragEvent, target: string | null) {
    if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return
    e.preventDefault()
    setOver(undefined)
    if (target === here && !current) return
    const keys = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]") as string[]
    const rows = keys.map((k) => {
      const [kind, id] = k.split(":") as ["folder" | "file" | "document", string]
      return { key: k, kind, id }
    })
    rows.forEach((r) => pendingRemovals.add(r.key))
    const results = await Promise.all(rows.map((r) => moveItem({ kind: r.kind, id: r.id, folderId: target })))
    const failed = results.find((r) => !r.ok)
    rows.forEach((r, i) => !results[i]!.ok && pendingRemovals.remove(r.key))
    if (failed && !failed.ok) return void toast.error(failed.error)
    const name = crumbs.find((c) => c.id === target)?.name ?? "the folder"
    toast.success(`${rows.length === 1 ? "Moved" : `${rows.length} items moved`} to ${name}`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await Promise.all(rows.map((r) => moveItem({ kind: r.kind, id: r.id, folderId: here })))
          rows.forEach((r) => pendingRemovals.remove(r.key))
        },
      },
    })
  }

  const dropProps = (id: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      setOver(id)
    },
    onDragLeave: () => setOver(undefined),
    onDrop: (e: DragEvent) => void drop(e, id),
  })

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-meta flex min-w-0 items-center gap-1 text-muted-foreground sm:flex-wrap">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1 && !current
          const isHidden = hidden.includes(c)
          return (
            <Fragment key={c.id ?? "root"}>
              {i > 0 && (
                <ChevronRightIcon className={cn("size-3 shrink-0", isHidden && "max-sm:hidden")} aria-hidden />
              )}
              {hidden.length > 0 && c === hidden[0] && (
                <li className="sm:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`${hidden.length} more folders`}
                      className="flex h-7 min-w-9 items-center justify-center rounded-md hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="glass glass-menu w-52">
                      {hidden.map((h) => (
                        <DropdownMenuItem key={h.id} render={<Link href={folderHref(h.id)} transitionTypes={NAV_BACK} />}>
                          {h.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )}
              {hidden.length > 0 && c === hidden[0] && <ChevronRightIcon className="size-3 shrink-0 sm:hidden" aria-hidden />}
              <li className={cn("min-w-0", isHidden && "max-sm:hidden", !last && "shrink-0 max-sm:max-w-[30%]")}>
                {last ? (
                  <span aria-current="page" className="block truncate text-foreground">
                    {c.name}
                  </span>
                ) : (
                  <Link
                    href={folderHref(c.id)}
                    transitionTypes={NAV_BACK}
                    {...dropProps(c.id)}
                    className={cn(
                      "block truncate rounded px-1 py-1 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      over === c.id && "bg-secondary text-text-accent ring-2 ring-accent-500/60",
                    )}
                  >
                    {c.name}
                  </Link>
                )}
              </li>
            </Fragment>
          )
        })}
        {current && (
          <>
            <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
            <li aria-current="page" className="min-w-0 truncate text-foreground">
              {current}
            </li>
          </>
        )}
      </ol>
    </nav>
  )
}
