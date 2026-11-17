"use client"

import { useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search } from "@/components/icons"
import { Input } from "@/components/ui/input"
import { selectClass } from "./bits"
import { categoryGroups, type AccountOption, type CategoryOption } from "./types"

/** Account, category and text filters; each change rewrites the URL (month stays). */
export function TransactionFilters({ accounts, categories }: { accounts: AccountOption[]; categories: CategoryOption[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [, start] = useTransition()
  const groups = categoryGroups(categories)

  function set(key: string, value: string) {
    const q = new URLSearchParams(params)
    if (value) q.set(key, value)
    else q.delete(key)
    q.delete("new")
    q.delete("edit")
    start(() => router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false }))
  }

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
      <label className="sr-only" htmlFor="f-account">
        Account
      </label>
      <select id="f-account" value={params.get("account") ?? ""} onChange={(e) => set("account", e.target.value)} className={selectClass}>
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.archived ? " (archived)" : ""}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="f-category">
        Category
      </label>
      <select id="f-category" value={params.get("category") ?? ""} onChange={(e) => set("category", e.target.value)} className={selectClass}>
        <option value="">All categories</option>
        <option value="none">Uncategorised</option>
        <optgroup label="Spending">
          {groups.expense.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Income">
          {groups.income.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </optgroup>
      </select>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          set("q", query.trim())
        }}
        className="relative"
      >
        <label className="sr-only" htmlFor="f-query">
          Search notes and tags
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="f-query"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => query.trim() !== (params.get("q") ?? "") && set("q", query.trim())}
          placeholder="Search notes, tags"
          className="pl-8"
        />
      </form>
    </div>
  )
}
