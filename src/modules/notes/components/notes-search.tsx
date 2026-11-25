"use client"

import { useEffect, useRef, useState, useTransition, type Ref } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Search, X } from "@/components/icons"
import { cn } from "@/lib/utils"

/** Filters the list through `?q=`, so a search survives reloads and can be linked. */
export function NotesSearch({ initialQuery, inputRef }: { initialQuery: string; inputRef?: Ref<HTMLInputElement> }) {
  const router = useRouter()
  const pathname = usePathname()
  const [value, setValue] = useState(initialQuery)
  const [pending, startTransition] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function update(next: string) {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const q = next.trim()
      startTransition(() => router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, { scroll: false }))
    }, 200)
  }

  return (
    <div className="relative">
      <Search
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground",
          pending && "animate-pulse",
        )}
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && update("")}
        placeholder="Filter notes"
        aria-label="Filter notes"
        className="h-9 w-full rounded-lg border border-field-border bg-field pr-9 pl-9 text-base outline-none md:text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => update("")}
          aria-label="Clear filter"
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
