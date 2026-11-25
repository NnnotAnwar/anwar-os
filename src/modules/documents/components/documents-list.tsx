"use client"

import Link from "next/link"
import { ChevronRightIcon, Paperclip } from "@/components/icons"
import { usePendingRemovals } from "@/components/list/pending"
import { NAV_FORWARD } from "@/components/motion"
import { formatDate } from "../lib/dates"
import { kindLabels, type DocumentItem } from "../schema"
import { KindIcon, StatusChip } from "./bits"

function validity(doc: DocumentItem) {
  const date = formatDate(doc.expiresOn)
  return doc.status.tone === "expired" ? `Was valid until ${date}` : `Valid until ${date}`
}

/** Every document, soonest expiry first (expired ones on top). Deletes waiting for Undo are already gone. */
export function DocumentsList({ documents }: { documents: DocumentItem[] }) {
  const removed = usePendingRemovals()
  const shown = documents.filter((doc) => !removed.has(doc.id))
  return (
    <ul className="grid gap-2" aria-label="Documents by expiry date">
      {shown.map((doc) => (
        <li key={doc.id}>
          <Link
            href={`/app/documents/${doc.id}`}
            transitionTypes={NAV_FORWARD}
            className="glass press flex min-h-16 items-center gap-3 rounded-xl p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:p-4"
          >
            <KindIcon kind={doc.kind} tone={doc.status.tone} />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-body-strong truncate">{doc.name}</span>
              <span className="text-caption flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <StatusChip status={doc.status} className="h-5 px-1.5 sm:hidden" />
                <span className="truncate tabular-nums sm:hidden">{formatDate(doc.expiresOn)}</span>
                <span className="truncate max-sm:hidden">
                  {kindLabels[doc.kind]} · {validity(doc)}
                </span>
                {doc.fileCount > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 tabular-nums" aria-label={`${doc.fileCount} attached`}>
                    <Paperclip className="size-3" />
                    {doc.fileCount}
                  </span>
                )}
              </span>
            </span>
            <StatusChip status={doc.status} className="max-sm:hidden" />
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
