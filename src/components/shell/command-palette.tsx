"use client"

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { CornerDownLeft, FileText, LogOut, Monitor, Moon, Sun } from "@/components/icons"
import { useTheme } from "next-themes"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { signOut } from "@/core/auth-actions"
import { searchEverything, type SearchGroup } from "@/core/search-actions"
import { OPEN_PALETTE_EVENT } from "./command-events"

export type PaletteLink = { label: string; href: string; icon: ReactNode }

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

export function CommandPalette({ nav, creates }: { nav: PaletteLink[]; creates: PaletteLink[] }) {
  const router = useRouter()
  const { setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchGroup[]>([])
  const [, startSearch] = useTransition()
  const latest = useRef("")

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen)
    }
  }, [])

  function onQueryChange(value: string) {
    setQuery(value)
    latest.current = value
    if (!value.trim()) return setResults([])
    // Debounce: only the last keystroke within 150 ms hits the server.
    setTimeout(() => {
      if (latest.current !== value) return
      startSearch(async () => {
        const groups = await searchEverything(value)
        if (latest.current === value) setResults(groups)
      })
    }, 150)
  }

  function run(action: () => void) {
    setOpen(false)
    setQuery("")
    setResults([])
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search and commands"
      description="Jump to a page, search your notes or run a command."
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput value={query} onValueChange={onQueryChange} placeholder="Search notes, pages, commands…" />
        <CommandList className="max-h-[min(60vh,26rem)]">
          <CommandEmpty>Nothing matches “{query}”.</CommandEmpty>

          {results.map((group) => (
            <CommandGroup key={group.moduleId} heading={group.moduleName}>
              {group.hits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={`${group.moduleId}:${hit.id}`}
                  // Server already matched these; keep cmdk from filtering them out.
                  keywords={[query]}
                  onSelect={() => run(() => router.push(hit.href))}
                >
                  <FileText />
                  <span className="grid min-w-0">
                    <span className="truncate">{hit.title}</span>
                    {hit.snippet && <span className="truncate text-xs text-muted-foreground">{hit.snippet}</span>}
                  </span>
                  <CommandShortcut>
                    <CornerDownLeft className="size-3" />
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {results.length > 0 && <CommandSeparator />}

          <CommandGroup heading="Go to">
            {nav.map((item) => (
              <CommandItem
                key={item.href}
                value={`go ${item.label}`}
                onSelect={() => run(() => router.push(item.href))}
              >
                {item.icon}
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>

          {creates.length > 0 && (
            <CommandGroup heading="Create">
              {creates.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`create ${item.label}`}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  {item.icon}
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandGroup heading="Appearance">
            <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}>
              <Sun />
              Light theme
            </CommandItem>
            <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}>
              <Moon />
              Dark theme
            </CommandItem>
            <CommandItem value="theme system" onSelect={() => run(() => setTheme("system"))}>
              <Monitor />
              Match system theme
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Account">
            <CommandItem value="sign out log out" onSelect={() => run(() => void signOut())}>
              <LogOut />
              Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
