import Link from "next/link"
import { Folder, FolderOpen, House } from "@/components/icons"
import { cn } from "@/lib/utils"
import { folderHref } from "../lib/links"
import type { Folder as FolderRow } from "../schema"

const linkClass =
  "text-meta flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * Every folder as a nested list. Branches on the way to the open folder are
 * expanded; the rest stay collapsed behind <details>, so it works without JS.
 */
export function FolderTree({ folders, currentId, openIds }: { folders: FolderRow[]; currentId: string | null; openIds: Set<string> }) {
  const children = new Map<string | null, FolderRow[]>()
  for (const f of folders) {
    const list = children.get(f.parentId) ?? []
    list.push(f)
    children.set(f.parentId, list)
  }

  const branch = (parentId: string | null) => {
    const list = children.get(parentId)
    if (!list?.length) return null
    return (
      <ul className={cn("grid gap-0.5", parentId && "ml-3 border-l border-hairline pl-1.5")}>
        {list.map((f) => {
          const active = f.id === currentId
          const Icon = active ? FolderOpen : Folder
          const link = (
            <Link
              href={folderHref(f.id)}
              aria-current={active ? "page" : undefined}
              className={cn(linkClass, active && "bg-secondary text-secondary-foreground")}
            >
              <Icon className="size-4 shrink-0 text-text-accent" />
              <span className="truncate">{f.name}</span>
            </Link>
          )
          return (
            <li key={f.id}>
              {children.get(f.id)?.length ? (
                <details open={openIds.has(f.id)} className="group">
                  <summary className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">{link}</summary>
                  {branch(f.id)}
                </details>
              ) : (
                link
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <nav aria-label="Folders" className="grid gap-0.5">
      <Link
        href={folderHref(null)}
        aria-current={currentId === null ? "page" : undefined}
        className={cn(linkClass, currentId === null && "bg-secondary text-secondary-foreground")}
      >
        <House className="size-4 shrink-0 text-text-accent" />
        All files
      </Link>
      {branch(null)}
    </nav>
  )
}
