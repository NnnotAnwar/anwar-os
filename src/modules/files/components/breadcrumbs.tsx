import { Fragment } from "react"
import Link from "next/link"
import { ChevronRightIcon } from "@/components/icons"
import { folderHref } from "../lib/links"
import type { Folder } from "../schema"

/** All files › Taxes › 2026. The last crumb is the current page unless `current` is given. */
export function Breadcrumbs({ path, current }: { path: Folder[]; current?: string }) {
  const crumbs = [{ id: null as string | null, name: "All files" }, ...path.map((f) => ({ id: f.id as string | null, name: f.name }))]
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-meta flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1 && !current
          return (
            <Fragment key={c.id ?? "root"}>
              {i > 0 && <ChevronRightIcon className="size-3 shrink-0" aria-hidden />}
              <li className="min-w-0">
                {last ? (
                  <span aria-current="page" className="block truncate text-foreground">
                    {c.name}
                  </span>
                ) : (
                  <Link href={folderHref(c.id)} className="block truncate rounded hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    {c.name}
                  </Link>
                )}
              </li>
            </Fragment>
          )
        })}
        {current && (
          <>
            <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
            <li aria-current="page" className="min-w-0 truncate text-foreground">
              {current}
            </li>
          </>
        )}
      </ol>
    </nav>
  )
}
