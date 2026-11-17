"use client"

import { useMemo, useRef, useState, useTransition, type RefObject } from "react"
import NextLink from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Bookmark,
  BookmarkFilled,
  CheckSquare,
  Globe,
  Lock,
  Pencil,
  Trash2,
} from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { pendingRemovals, usePendingRemovals } from "@/components/list/pending"
import { RowContextMenu } from "@/components/list/row-menu"
import { BulkBar, SelectButton, SelectCheck, useSelection } from "@/components/list/selection"
import { ShortcutHint } from "@/components/list/shortcut-hint"
import { SwipeRow, type RowAction } from "@/components/list/swipe-row"
import { useListKeyboard } from "@/components/list/use-list-keyboard"
import { Button, buttonVariants } from "@/components/ui/button"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { deleteLinks, setLinksFlags } from "../server-actions"
import { domainOf, type Link } from "../schema"
import { Favicon } from "./favicon"

type Flags = { isPublic?: boolean; readLater?: boolean }

/** The search field lives in the server-rendered toolbar; find it by id. */
const filterRef: RefObject<HTMLInputElement | null> = {
  get current() {
    return typeof document === "undefined" ? null : (document.getElementById("list-filter") as HTMLInputElement | null)
  },
}

/**
 * Dense rows: icon, title (opens the page), domain and tags. On phones: swipe
 * right for read later, left for delete / publish, hold for the menu. On
 * desktop the same actions sit on the row, in the right-click menu and on keys.
 */
export function LinkList({ links }: { links: Link[] }) {
  const router = useRouter()
  const removed = usePendingRemovals()
  const [overrides, setOverrides] = useState<Map<string, Flags>>(new Map())
  const [, startTransition] = useTransition()
  const container = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () =>
      links
        .filter((l) => !removed.has(l.id))
        .map((l) => {
          const o = overrides.get(l.id)
          return o ? { ...l, is_public: o.isPublic ?? l.is_public, read_later: o.readLater ?? l.read_later } : l
        }),
    [links, removed, overrides],
  )
  const byId = new Map(items.map((l) => [l.id, l]))
  const selection = useSelection(items.map((l) => l.id))

  function setFlags(ids: string[], flags: Flags, undoable = true) {
    const before = ids.map((id) => {
      const l = byId.get(id)
      return [id, { isPublic: l?.is_public, readLater: l?.read_later }] as const
    })
    const apply = (entries: (readonly [string, Flags])[]) =>
      setOverrides((prev) => {
        const next = new Map(prev)
        for (const [id, f] of entries) next.set(id, { ...next.get(id), ...f })
        return next
      })
    apply(ids.map((id) => [id, flags] as const))
    startTransition(async () => {
      const result = await setLinksFlags({ ids, ...flags })
      if (!result.ok) {
        apply(before)
        return void toast.error(result.error)
      }
      if (!undoable) return
      const what = ids.length === 1 ? "" : `${ids.length} links `
      const message =
        flags.isPublic !== undefined
          ? flags.isPublic
            ? `${what}Published on your links page`
            : `${what}Hidden from your links page`
          : flags.readLater
            ? `${what}Saved to read later`
            : `${what}Removed from read later`
      toast.success(message.charAt(0).toUpperCase() + message.slice(1), {
        action: {
          label: "Undo",
          onClick: () => {
            for (const [id, was] of before) {
              setFlags(
                [id],
                flags.isPublic !== undefined ? { isPublic: was.isPublic } : { readLater: was.readLater },
                false,
              )
            }
          },
        },
      })
    })
  }

  function remove(ids: string[]) {
    if (!ids.length) return
    selection.done()
    const single = ids.length === 1 ? byId.get(ids[0]!) : null
    removeWithUndo({
      message: single ? "Link deleted" : `${ids.length} links deleted`,
      hide: () => ids.forEach((id) => pendingRemovals.add(id)),
      restore: () => ids.forEach((id) => pendingRemovals.remove(id)),
      commit: () => deleteLinks({ ids }),
    })
  }

  const targets = (id: string | null) => (selection.count ? [...selection.ids] : id ? [id] : [])
  const toggleFlag = (key: "isPublic" | "readLater", id: string | null) => {
    const ids = targets(id)
    if (!ids.length) return
    const field = key === "isPublic" ? "is_public" : "read_later"
    setFlags(ids, { [key]: !ids.every((i) => byId.get(i)?.[field]) })
  }

  useListKeyboard({
    container,
    filter: filterRef,
    selection,
    handlers: {
      new: () => {
        const field = document.getElementById("add-link") as HTMLInputElement | null
        field?.focus()
      },
      open: (id) => {
        const link = id && byId.get(id)
        if (link) window.open(link.url, "_blank", "noopener,noreferrer")
      },
      edit: (id) => id && router.push(`/app/links/${id}`),
      pin: (id) => toggleFlag("isPublic", id),
      delete: (id) => remove(targets(id)),
    },
    extra: { r: (id) => toggleFlag("readLater", id) },
  })

  function actionsFor(link: Link): RowAction[] {
    return [
      {
        id: "later",
        label: link.read_later ? "Remove from read later" : "Read later",
        icon: link.read_later ? BookmarkFilled : Bookmark,
        tone: "accent",
        onSelect: () => setFlags([link.id], { readLater: !link.read_later }),
        shortcut: "R",
      },
      {
        id: "public",
        label: link.is_public ? "Hide from public page" : "Publish",
        icon: link.is_public ? Lock : Globe,
        tone: "neutral",
        onSelect: () => setFlags([link.id], { isPublic: !link.is_public }),
        shortcut: "P",
      },
      { id: "edit", label: "Edit", icon: Pencil, onSelect: () => router.push(`/app/links/${link.id}`), shortcut: "E" },
      { id: "select", label: "Select", icon: CheckSquare, onSelect: () => selection.toggle(link.id), shortcut: "X" },
      { id: "delete", label: "Delete", icon: Trash2, tone: "destructive", onSelect: () => remove([link.id]), shortcut: "⌫" },
    ]
  }

  const allLater = selection.count > 0 && [...selection.ids].every((id) => byId.get(id)?.read_later)
  const allPublic = selection.count > 0 && [...selection.ids].every((id) => byId.get(id)?.is_public)

  return (
    <div ref={container} className="grid gap-2">
      <div className="-mt-1 -mb-1 flex justify-end">
        <SelectButton selection={selection} disabled={items.length === 0} />
      </div>
      <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
        {items.map((link) => {
          const actions = actionsFor(link)
          const checked = selection.has(link.id)
          return (
            <li key={link.id} data-row-id={link.id}>
              <SwipeRow
                disabled={selection.active}
                leading={{ ...actions[0]!, label: link.read_later ? "Unmark" : "Later" }}
                trailing={[actions[4]!, { ...actions[1]!, label: link.is_public ? "Hide" : "Publish" }]}
              >
                <RowContextMenu actions={actions} label={link.title}>
                  <div
                    className={cn(
                      "group flex items-start gap-3 px-3 py-2.5 hover:bg-white/40 sm:px-4 dark:hover:bg-white/5",
                      checked && "bg-secondary hover:bg-secondary",
                    )}
                    onClickCapture={(e) => {
                      if (!selection.active && !e.shiftKey) return
                      if ((e.target as HTMLElement).closest("[data-row-tools]")) return
                      e.preventDefault()
                      e.stopPropagation()
                      if (e.shiftKey) selection.extend(link.id)
                      else selection.toggle(link.id)
                    }}
                  >
                    {selection.active ? (
                      <SelectCheck checked={checked} className="mt-px" />
                    ) : (
                      <Favicon src={link.favicon_url} name={link.site_name || domainOf(link.url)} className="mt-0.5" />
                    )}
                    <div className="grid min-w-0 flex-1 gap-1">
                      <a
                        data-row-primary
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-body line-clamp-2 rounded [overflow-wrap:anywhere] outline-none hover:text-text-accent hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {link.title}
                      </a>
                      <div className="text-caption flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                        <span className="truncate">{link.site_name || domainOf(link.url)}</span>
                        {link.read_later && (
                          <span className="inline-flex items-center gap-1 text-text-accent sm:hidden">
                            <BookmarkFilled className="size-3" />
                            Later
                          </span>
                        )}
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
                    {/* Phones use swipe and long-press; these are for mouse and keyboard. */}
                    <div data-row-tools className="-my-1 -mr-1 hidden shrink-0 items-center sm:flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-pressed={link.read_later}
                        aria-label={link.read_later ? `Remove “${link.title}” from read later` : `Read “${link.title}” later`}
                        title={link.read_later ? "Remove from read later (R)" : "Read later (R)"}
                        onClick={() => setFlags([link.id], { readLater: !link.read_later })}
                        className={cn(link.read_later ? "text-text-accent" : "text-muted-foreground")}
                      >
                        {link.read_later ? <BookmarkFilled /> : <Bookmark />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-pressed={link.is_public}
                        aria-label={link.is_public ? `Hide “${link.title}” from your public page` : `Publish “${link.title}”`}
                        title={link.is_public ? "Public — click to hide (P)" : "Private — click to publish (P)"}
                        onClick={() => setFlags([link.id], { isPublic: !link.is_public })}
                        className={cn(link.is_public ? "text-text-accent" : "text-muted-foreground")}
                      >
                        {link.is_public ? <Globe /> : <Lock />}
                      </Button>
                      <NextLink
                        href={`/app/links/${link.id}`}
                        transitionTypes={NAV_FORWARD}
                        aria-label={`Edit “${link.title}”`}
                        title="Edit (E)"
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "text-muted-foreground")}
                      >
                        <Pencil />
                      </NextLink>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete “${link.title}”`}
                        title="Delete (⌫)"
                        onClick={() => remove([link.id])}
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
        className="pt-1"
        items={[
          [["J", "K"], "move"],
          [["↵"], "open"],
          [["R"], "read later"],
          [["P"], "publish"],
          [["E"], "edit"],
          [["X"], "select"],
          [["⌫"], "delete"],
          [["/"], "search"],
        ]}
        touch="Swipe right to read later, left to delete or publish. Hold a link for more."
      />
      <BulkBar selection={selection} noun={["link", "links"]} total={items.length}>
        <Button
          variant="ghost"
          size="lg"
          disabled={!selection.count}
          onClick={() => {
            setFlags([...selection.ids], { readLater: !allLater })
            selection.done()
          }}
          aria-label={allLater ? "Remove from read later" : "Read later"}
        >
          {allLater ? <BookmarkFilled /> : <Bookmark />}
          <span className="max-sm:sr-only">Later</span>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          disabled={!selection.count}
          onClick={() => {
            setFlags([...selection.ids], { isPublic: !allPublic })
            selection.done()
          }}
          aria-label={allPublic ? "Hide from public page" : "Publish"}
        >
          {allPublic ? <Lock /> : <Globe />}
          <span className="max-sm:sr-only">{allPublic ? "Hide" : "Publish"}</span>
        </Button>
        <Button variant="destructive" size="lg" disabled={!selection.count} onClick={() => remove([...selection.ids])}>
          <Trash2 />
          <span className="max-sm:sr-only">Delete</span>
        </Button>
      </BulkBar>
    </div>
  )
}
