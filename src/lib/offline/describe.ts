import type { OutboxItem, OutboxKind } from "./outbox"

export const kindLabels: Record<OutboxKind, string> = { inbox: "Inbox", task: "Task", note: "Note", expense: "Expense" }

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/** One line for an outbox item: what was typed. */
export function describeItem(item: Pick<OutboxItem, "kind" | "payload">): string {
  const p = item.payload
  switch (item.kind) {
    case "note":
      return str(p.title) || str(p.body).split("\n")[0] || "Untitled note"
    case "inbox":
      return str(p.text).split("\n")[0] || str(p.url) || "Captured item"
    default:
      return str(p.text) || kindLabels[item.kind]
  }
}

/** "2 waiting to sync", "1 didn't sync", for the header. */
export function outboxSummary(items: Pick<OutboxItem, "status">[]): string | null {
  const failed = items.filter((i) => i.status === "failed").length
  const waiting = items.length - failed
  if (failed) return `${failed} didn't sync`
  if (waiting) return `${waiting} waiting to sync`
  return null
}
