"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { defaultFilter } from "cmdk"
import { ArrowRight, Clock, CornerDownLeft, History, LogOut, Monitor, Moon, Sun } from "@/components/icons"
import { useTheme } from "@/components/theme/theme-provider"
import type { ThemeMode } from "@/lib/theme"
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { rememberSearch, useRecentSearches } from "@/components/search/recent-searches"
import {
  countLabel,
  FailedNote,
  HitBody,
  ModuleChips,
  NoResults,
  SearchError,
  type SearchModule,
} from "@/components/search/search-parts"
import { useGlobalSearch } from "@/components/search/use-global-search"
import { signOutSafely } from "@/components/offline/sign-out"
import { cn } from "@/lib/utils"
import { listenFor, OPEN_PALETTE_EVENT } from "./command-events"

export type PaletteLink = { label: string; href: string; icon: ReactNode }

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

/**
 * ⌘K (or /): global search across every service the viewer can use, plus
 * "Go to", "Create" and a few commands. Results come from /api/search
 * (debounced, stale requests cancelled), grouped by service with counts;
 * chips narrow the search to one service.
 */
export function CommandPalette({
  nav,
  creates,
  modules,
}: {
  nav: PaletteLink[]
  creates: PaletteLink[]
  modules: SearchModule[]
}) {
  const router = useRouter()
  const { setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const search = useGlobalSearch()
  const recent = useRecentSearches()
  const input = useRef<HTMLInputElement>(null)

  const isOpen = useRef(false)
  useEffect(() => {
    isOpen.current = open
  }, [open])

  const { reset } = search
  useEffect(() => {
    // Each opening starts fresh: empty field, recent searches, no stale answers.
    function show() {
      reset()
      setOpen(true)
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        if (isOpen.current) setOpen(false)
        else show()
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault()
        if (!isOpen.current) show()
      }
    }
    window.addEventListener("keydown", onKey)
    const stopListening = listenFor(OPEN_PALETTE_EVENT, show)
    return () => {
      window.removeEventListener("keydown", onKey)
      stopListening()
    }
  }, [reset])

  function run(action: () => void) {
    setOpen(false)
    action()
  }

  const { q } = search
  // Commands are filtered here (cmdk's own filtering is off so the server's
  // ranking of results stays as it is).
  const show = (text: string) => !q || defaultFilter(text, q) > 0
  const commands = search.module ? [] : nav.filter((item) => show(`go ${item.label}`))
  const createItems = search.module ? [] : creates.filter((item) => show(`create ${item.label}`))
  const themes = (
    [
      { value: "light", label: "Light theme", icon: <Sun /> },
      { value: "dark", label: "Dark theme", icon: <Moon /> },
      { value: "system", label: "Match system theme", icon: <Monitor /> },
      { value: "scheduled", label: "Scheduled theme (dark at night)", icon: <Clock /> },
    ] satisfies { value: ThemeMode; label: string; icon: ReactNode }[]
  ).filter((t) => !search.module && show(`theme ${t.label}`))
  const showSignOut = !search.module && show("sign out log out")

  const groups = search.data?.groups ?? []
  const activeName = modules.find((m) => m.id === search.module)?.name ?? null
  const iconOf = (id: string) => modules.find((m) => m.id === id)?.icon
  const noResults = Boolean(q) && Boolean(search.data) && !groups.length && !search.loading && !search.error

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search and commands"
      description="Search everything, jump to a page or run a command."
      // High enough that the results list fits on a laptop screen.
      className="top-[12vh] sm:max-w-xl"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          ref={input}
          value={search.query}
          onValueChange={search.setQuery}
          placeholder="Search everything or jump to…"
          aria-label="Search everything"
          maxLength={100}
        />
        <ModuleChips
          size="sm"
          modules={modules}
          active={search.module}
          onChange={(id) => {
            search.setModule(id)
            input.current?.focus()
          }}
          overview={search.overview}
          className="px-1.5 pt-2 pb-1"
        />
        <CommandList className={cn("max-h-[min(60vh,28rem)] transition-opacity", search.stale && "opacity-60")}>
          {!q && recent.length > 0 && (
            <CommandGroup heading="Recent searches">
              {recent.map((r) => (
                <CommandItem key={r} value={`recent:${r}`} onSelect={() => search.setQuery(r)}>
                  <History />
                  <span className="truncate">{r}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {q && search.error && <SearchError onRetry={search.retry} />}
          {noResults && <NoResults query={q} moduleName={activeName} onSearchAll={() => search.setModule(null)} />}
          {q && search.loading && !search.data && (
            <p className="text-meta px-3 py-6 text-center text-muted-foreground" role="status">
              Searching…
            </p>
          )}

          {groups.map((group) => (
            <CommandGroup
              key={group.moduleId}
              heading={
                <span className="flex items-center gap-1.5">
                  {group.moduleName}{" "}
                  <span className="tabular-nums opacity-70">{countLabel(group)}</span>
                </span>
              }
            >
              {group.hits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={`hit:${group.moduleId}:${hit.id}`}
                  onSelect={() =>
                    run(() => {
                      rememberSearch(q)
                      router.push(hit.href)
                    })
                  }
                  className="items-start py-2"
                >
                  <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{iconOf(group.moduleId)}</span>
                  <HitBody hit={hit} query={q} />
                  <CommandShortcut className="mt-0.5 opacity-0 group-data-selected/command-item:opacity-100">
                    <CornerDownLeft className="size-3" />
                  </CommandShortcut>
                </CommandItem>
              ))}
              {group.more && !search.module && (
                <CommandItem
                  value={`more:${group.moduleId}`}
                  onSelect={() => search.setModule(group.moduleId)}
                  className="text-text-accent"
                >
                  <ArrowRight />
                  See all in {group.moduleName}
                </CommandItem>
              )}
            </CommandGroup>
          ))}
          {search.data && <FailedNote failed={search.data.failed} modules={modules} />}
          {groups.length > 0 && (commands.length > 0 || createItems.length > 0 || themes.length > 0 || showSignOut) && <CommandSeparator />}

          {commands.length > 0 && (
            <CommandGroup heading="Go to">
              {commands.map((item) => (
                <CommandItem key={item.href} value={`go ${item.label}`} onSelect={() => run(() => router.push(item.href))}>
                  {item.icon}
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {createItems.length > 0 && (
            <CommandGroup heading="Create">
              {createItems.map((item) => (
                <CommandItem key={item.href} value={`create ${item.label}`} onSelect={() => run(() => router.push(item.href))}>
                  {item.icon}
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {themes.length > 0 && (
            <CommandGroup heading="Appearance">
              {themes.map((t) => (
                <CommandItem key={t.value} value={`theme ${t.value}`} onSelect={() => run(() => setTheme(t.value))}>
                  {t.icon}
                  {t.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showSignOut && (
            <CommandGroup heading="Account">
              <CommandItem value="sign out log out" onSelect={() => run(() => void signOutSafely())}>
                <LogOut />
                Sign out
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
