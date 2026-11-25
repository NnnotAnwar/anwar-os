import Link from "next/link"
import { actions } from "../actions"
import { KindIcon, StatusChip } from "../components/bits"
import { SOON_DAYS } from "../lib/status"

/**
 * Today: the most pressing document (expired first, then the next to expire
 * within 90 days). With nothing coming up the tile hides itself: Today hides a
 * widget section that renders `data-widget-empty`.
 */
export async function NextExpiring() {
  const { documents } = await actions.upcoming.handler({ days: SOON_DAYS, includeExpired: true })
  const next = documents[0]
  if (!next) return <span data-widget-empty hidden />
  const more = documents.length - 1
  return (
    <div className="grid gap-2">
      <Link
        href={`/app/documents/${next.id}`}
        className="press -mx-2 flex min-h-12 items-center gap-3 rounded-lg px-2 py-1 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <KindIcon kind={next.kind} tone={next.status.tone} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-body-strong truncate">{next.name}</span>
          <span className="text-caption truncate text-muted-foreground">{next.status.detail}</span>
        </span>
        <StatusChip status={next.status} className="max-sm:hidden" />
      </Link>
      {more > 0 && (
        <Link href="/app/documents" className="text-caption w-fit rounded py-1 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          {more === 1 ? "1 more expiring soon" : `${more} more expiring soon`}
        </Link>
      )}
    </div>
  )
}
