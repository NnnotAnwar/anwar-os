import Link from "next/link"
import type { ViewerContext } from "@/core/module"
import { formatRelative } from "@/lib/time"
import { actions } from "../actions"
import { ItemIcon } from "../components/file-type-icon"
import { itemHref } from "../lib/links"
import { formatBytes } from "../lib/validation"

const rowClass =
  "-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"

export async function RecentlyAdded({ ctx }: { ctx: ViewerContext }) {
  const items = await actions.recent.handler({ limit: 6 })
  if (items.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        Nothing filed yet.{" "}
        <Link href="/app/files" className="text-text-accent underline-offset-4 hover:underline">
          Upload a file or write a document
        </Link>
      </p>
    )
  }
  const now = new Date()
  return (
    <ul className="grid gap-0.5">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          <Link href={itemHref(item)} className={rowClass}>
            <ItemIcon item={item} className="size-7" />
            <span className="grid min-w-0 flex-1">
              <span className="text-body truncate">{item.name}</span>
              <span className="text-caption truncate text-muted-foreground">
                {item.kind === "document" ? "Document" : formatBytes(item.size)}
              </span>
            </span>
            <time dateTime={item.createdAt} className="text-caption shrink-0 text-muted-foreground tabular-nums">
              {formatRelative(new Date(item.createdAt), now, ctx.locale)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  )
}
