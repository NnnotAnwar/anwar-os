"use client"

import type { ReactElement, ReactNode } from "react"
import { ContextMenu } from "@base-ui/react/context-menu"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import type { RowAction } from "./swipe-row"

/**
 * Right-click (or long-press on touch) a row for the same actions as its
 * swipe and keys. Destructive actions go last, after a separator.
 */
export function RowContextMenu({
  actions,
  label,
  render,
  children,
}: {
  actions: RowAction[]
  /** The row's name, read out as the menu's label. */
  label: string
  /** The element the trigger renders as (defaults to a div). */
  render?: ReactElement
  children: ReactNode
}) {
  const regular = actions.filter((a) => a.tone !== "destructive")
  const destructive = actions.filter((a) => a.tone === "destructive")
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={render}
        // No iOS link callout or text selection on long-press: the menu opens instead.
        className="[-webkit-touch-callout:none] pointer-coarse:select-none"
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="isolate z-50 outline-none">
          <ContextMenu.Popup
            aria-label={label}
            className={cn(
              "glass glass-menu z-50 min-w-48 origin-(--transform-origin) rounded-lg p-1 text-popover-foreground outline-none",
              "duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            {regular.map((a) => (
              <Item key={a.id} action={a} />
            ))}
            {regular.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
            {destructive.map((a) => (
              <Item key={a.id} action={a} />
            ))}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function Item({ action }: { action: RowAction }) {
  const Icon = action.icon
  return (
    <DropdownMenuItem
      variant={action.tone === "destructive" ? "destructive" : "default"}
      onClick={action.onSelect}
      className="min-h-9 pointer-coarse:min-h-11"
    >
      <Icon />
      <span className="flex-1">{action.label}</span>
      {action.shortcut && <Kbd className="pointer-coarse:hidden">{action.shortcut}</Kbd>}
    </DropdownMenuItem>
  )
}
