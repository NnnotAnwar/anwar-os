"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "@/components/icons"
import { cn } from "@/lib/utils"

/** Filters through `?q=` and keeps the other filters (tag, view) in the URL. */
export function LinksSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(initialQuery)
  const [pending, startTransition] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function update(next: string) {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const search = new URLSearchParams(params)
      const q = next.trim()
      if (q) search.set("q", q)
      else search.delete("q")
      search.delete("add")
      const qs = search.toString()
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    }, 200)
  }

  return (
    <div className="relative">
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground",
          pending && "animate-pulse",
        )}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && update("")}
        placeholder="Search links, e.g. postgres"
        aria-label="Search links"
        className="h-9 w-full rounded-lg border border-field-border bg-field pr-9 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => update("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-track hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
