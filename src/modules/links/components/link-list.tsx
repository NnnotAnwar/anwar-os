"use client"

import { useOptimistic, useTransition } from "react"
import NextLink from "next/link"
import { toast } from "sonner"
import { Bookmark, BookmarkFilled, Globe, Lock, Pencil, Trash2 } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { deleteLink, restoreLink, setLinkFlags } from "../server-actions"
import { domainOf, type Link } from "../schema"
import { Favicon } from "./favicon"

type Change = { id: string } & ({ kind: "flags"; isPublic?: boolean; readLater?: boolean } | { kind: "delete" })

/**
 * Dense rows: icon, title (opens the page), domain and tags. Read later,
 * publish and delete act in one tap; delete offers Undo in the toast.
 */
export function LinkList({ links }: { links: Link[] }) {
  const [items, apply] = useOptimistic(links, (state: Link[], change: Change) =>
    change.kind === "delete"
      ? state.filter((l) => l.id !== change.id)
      : state.map((l) =>
          l.id === change.id
            ? {
                ...l,
                is_public: change.isPublic ?? l.is_public,
                read_later: change.readLater ?? l.read_later,
              }
            : l,
        ),
  )
  const [, startTransition] = useTransition()

  function setFlags(link: Link, flags: { isPublic?: boolean; readLater?: boolean }) {
    startTransition(async () => {
      apply({ id: link.id, kind: "flags", ...flags })
      const result = await setLinkFlags({ id: link.id, ...flags })
      if (!result.ok) return void toast.error(result.error)
      const undo = {
        label: "Undo",
        onClick: () =>
          startTransition(async () => {
            const back = await setLinkFlags({
              id: link.id,
              ...(flags.isPublic !== undefined && { isPublic: link.is_public }),
              ...(flags.readLater !== undefined && { readLater: link.read_later }),
            })
            if (!back.ok) toast.error(back.error)
          }),
      }
      if (flags.isPublic !== undefined) {
        toast.success(flags.isPublic ? "Published on your links page" : "Hidden from your links page", { action: undo })
      } else {
        toast.success(flags.readLater ? "Saved to read later" : "Removed from read later", { action: undo })
      }
    })
  }

  function remove(link: Link) {
    startTransition(async () => {
      apply({ id: link.id, kind: "delete" })
      const result = await deleteLink({ id: link.id })
      if (!result.ok) return void toast.error(result.error)
      const deleted = result.data
      toast.success("Link deleted", {
        description: link.title,
        action: deleted
          ? {
              label: "Undo",
              onClick: () =>
                startTransition(async () => {
                  const back = await restoreLink(deleted)
                  if (!back.ok) toast.error(back.error)
                }),
            }
          : undefined,
      })
    })
  }

  return (
    <ul className="glass divide-y divide-hairline rounded-xl">
      {items.map((link) => (
        <li key={link.id} className="group flex items-start gap-3 px-3 py-2.5 sm:px-4">
          <Favicon src={link.favicon_url} className="mt-0.5" />
          <div className="grid min-w-0 flex-1 gap-1">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-body line-clamp-2 rounded [overflow-wrap:anywhere] outline-none hover:text-text-accent hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {link.title}
            </a>
            <div className="text-caption flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <span className="truncate">{link.site_name || domainOf(link.url)}</span>
              {link.is_public && (
                <span className="inline-flex items-center gap-1 text-text-accent">
                  <Globe className="size-3" />
                  Public
                </span>
              )}
              {link.tags.map((tag) => (
                <NextLink
                  key={tag}
                  href={`/app/links?tag=${encodeURIComponent(tag)}`}
                  className="rounded-full bg-track px-1.5 py-0.5 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  #{tag}
                </NextLink>
              ))}
            </div>
            {link.note && <p className="text-meta line-clamp-2 text-muted-foreground">{link.note}</p>}
          </div>
          <div className="-my-1 -mr-1 flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={link.read_later}
              aria-label={link.read_later ? `Remove “${link.title}” from read later` : `Read “${link.title}” later`}
              title={link.read_later ? "Remove from read later" : "Read later"}
              onClick={() => setFlags(link, { readLater: !link.read_later })}
              className={cn("max-sm:size-9", link.read_later && "text-text-accent")}
            >
              {link.read_later ? <BookmarkFilled /> : <Bookmark />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={link.is_public}
              aria-label={link.is_public ? `Hide “${link.title}” from your public page` : `Publish “${link.title}”`}
              title={link.is_public ? "Public — tap to hide" : "Private — tap to publish"}
              onClick={() => setFlags(link, { isPublic: !link.is_public })}
              className={cn("max-sm:size-9", link.is_public && "text-text-accent")}
            >
              {link.is_public ? <Globe /> : <Lock />}
            </Button>
            <NextLink
              href={`/app/links/${link.id}`}
              aria-label={`Edit “${link.title}”`}
              title="Edit"
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "max-sm:size-9")}
            >
              <Pencil />
            </NextLink>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete “${link.title}”`}
              title="Delete"
              onClick={() => remove(link)}
              className="max-sm:size-9 hover:text-destructive"
            >
              <Trash2 />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
