"use client"

import { Check } from "@/components/icons"
import { renderInline, renderMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import { segments } from "../lib/checklist"

/**
 * The note as it reads: markdown rendered, checklists as real boxes you tick
 * with one tap. Tapping anywhere that isn't a box or a link starts editing.
 */
export function NotePreview({
  body,
  onToggle,
  onEdit,
}: {
  body: string
  onToggle: (line: number) => void
  onEdit: () => void
}) {
  const parts = segments(body)
  return (
    <div
      className="min-h-[50vh] cursor-text text-base leading-7"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, label")) return
        if (window.getSelection()?.toString()) return
        onEdit()
      }}
    >
      {parts.length === 0 && <p className="text-muted-foreground/60">Nothing here yet. Tap to write.</p>}
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <div key={i}>{renderMarkdown(part.text)}</div>
        ) : (
          <ul key={i} className="my-3 grid gap-0.5" aria-label="Checklist">
            {part.tasks.map((task) => (
              <li
                key={task.line}
                // The whole row ticks (links inside it still open).
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return
                  e.stopPropagation()
                  onToggle(task.line)
                }}
                className="group -mx-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-white/40 md:min-h-9 md:py-1 dark:hover:bg-white/5"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={task.done}
                  aria-labelledby={`task-${task.line}`}
                  className={cn(
                    "mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border-2 outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
                    task.done ? "animate-pop border-primary bg-primary text-primary-foreground" : "border-field-border bg-field group-hover:border-accent-400",
                  )}
                >
                  {task.done && <Check className="size-3" />}
                </button>
                <span id={`task-${task.line}`} className={cn("min-w-0 flex-1", task.done && "text-muted-foreground line-through decoration-1")}>
                  {task.text ? renderInline(task.text, `t${task.line}`) : <span className="text-muted-foreground/60">Empty item</span>}
                </span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}
