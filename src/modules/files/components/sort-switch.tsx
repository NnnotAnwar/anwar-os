import Link from "next/link"
import { ArrowDown, ArrowUp } from "@/components/icons"
import { cn } from "@/lib/utils"
import { folderHref } from "../lib/links"
import { defaultDir, type SortDir, type SortKey } from "../schema"

const labels: Record<SortKey, string> = { name: "Name", date: "Date", size: "Size" }

/** Segmented Name / Date / Size; choosing the active one flips the direction. */
export function SortSwitch({ folderId, sort, dir }: { folderId: string | null; sort: SortKey; dir: SortDir }) {
  return (
    <nav aria-label="Sort by" className="segmented shrink-0">
      {(Object.keys(labels) as SortKey[]).map((key) => {
        const active = key === sort
        const nextDir = active ? (dir === "asc" ? "desc" : "asc") : defaultDir(key)
        const Arrow = dir === "asc" ? ArrowUp : ArrowDown
        return (
          <Link
            key={key}
            href={folderHref(folderId, { sort: key, dir: nextDir })}
            replace
            scroll={false}
            aria-current={active ? "true" : undefined}
            aria-label={`Sort by ${labels[key].toLowerCase()}${active ? `, ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
            className={cn(
              "text-small flex h-7 items-center gap-1 rounded-lg px-2.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              active && "segment-active text-foreground",
            )}
          >
            {labels[key]}
            {active && <Arrow className="size-3" />}
          </Link>
        )
      })}
    </nav>
  )
}
