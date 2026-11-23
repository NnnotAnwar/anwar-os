"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "@/components/icons"
import { cn } from "@/lib/utils"

/** Searches the whole knowledge base through `?q=`, so results can be linked. */
export function FilesSearch({ initialQuery }: { initialQuery: string }) {
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
      const q = next.trim()
      const nextParams = new URLSearchParams(params)
      if (q) nextParams.set("q", q)
      else nextParams.delete("q")
      const qs = nextParams.toString()
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    }, 250)
  }

  return (
    <div className="relative">
      <Search
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground",
          pending && "animate-pulse",
        )}
      />
      <input
        id="files-filter"
        type="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && update("")}
        placeholder="Search names, tags and document text"
        aria-label="Search files and documents"
        // 16px on phones (max-md:text-base): iOS zooms the page into any field set smaller.
        className="text-meta h-9 max-md:h-10 max-md:text-base w-full rounded-lg border border-field-border bg-field pr-9 pl-8.5 outline-none placeholder:text-muted-foreground focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-ring/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => update("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
