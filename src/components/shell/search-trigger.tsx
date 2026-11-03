"use client"

import { useSyncExternalStore } from "react"
import { Search } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { openCommandPalette } from "./command-events"

const subscribe = () => () => {}
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform)

export function useModKey() {
  return useSyncExternalStore(subscribe, () => (isMac() ? "⌘" : "Ctrl"), () => "⌘")
}

export function SearchTrigger({ className }: { className?: string }) {
  const mod = useModKey()
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className={cn(
        "group flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground transition-colors outline-none hover:border-input hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate text-left">Search or jump to…</span>
      <Kbd className="hidden font-mono sm:inline-flex">{mod} K</Kbd>
    </button>
  )
}

export function SearchIconTrigger() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Search"
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Search className="size-[18px]" aria-hidden />
    </button>
  )
}
