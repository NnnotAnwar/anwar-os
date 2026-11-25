"use client"

import { useEffect, useRef, useState } from "react"
import { Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { repeatLabel } from "../lib/format"
import { priorityLabels, taskPriorities, type ProjectOption, type Task, type TaskList, type TaskPriority } from "../schema"
import { getProjectOptions } from "../server-actions"
import { quickDates } from "./schedule-sheet"
import { Sheet } from "@/components/sheet"
import { GoalPicker } from "@/modules/goals/components/goal-picker"

export type TaskPatch = Partial<Pick<Task, "title" | "notes" | "dueDate" | "dueTime" | "priority" | "listId" | "projectId" | "rrule">>

const REPEATS: { value: string; label: string }[] = [
  { value: "", label: "Never" },
  { value: "FREQ=DAILY", label: "Every day" },
  { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "Every weekday" },
  { value: "FREQ=WEEKLY", label: "Every week" },
  { value: "FREQ=WEEKLY;INTERVAL=2", label: "Every 2 weeks" },
  { value: "FREQ=MONTHLY", label: "Every month" },
  { value: "FREQ=YEARLY", label: "Every year" },
]

const fieldLabel = "text-eyebrow text-muted-foreground"
const selectClass =
  "text-body h-10 w-full max-md:text-base rounded-lg border border-field-border bg-field px-2.5 outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 md:h-9"

/**
 * Task details as a sheet. Edits apply when the sheet closes (Things-style:
 * no Save button to forget); Escape and the grab handle close it too.
 */
export function TaskEditor({
  task,
  lists,
  today,
  locale,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task | null
  lists: TaskList[]
  today: string
  locale: string
  onClose: () => void
  onSave: (task: Task, patch: TaskPatch) => void
  onDelete: (task: Task) => void
}) {
  const patch = useRef<TaskPatch>({})

  function close() {
    if (task) {
      const changed = Object.entries(patch.current).filter(([k, val]) => task[k as keyof Task] !== val)
      const next = Object.fromEntries(changed) as TaskPatch
      // An emptied title keeps the old one rather than blocking the close.
      if (next.title !== undefined && !next.title.trim()) delete next.title
      if (Object.keys(next).length) onSave(task, next)
    }
    patch.current = {}
    onClose()
  }

  return (
    <Sheet open={task !== null} onOpenChange={(open) => !open && close()} title="Task details" hideTitle className="sm:max-w-lg">
      {task && (
        <EditorForm
          key={task.id}
          task={task}
          lists={lists}
          today={today}
          locale={locale}
          onChange={(p) => (patch.current = p)}
          onDone={close}
          onDelete={(t) => {
            patch.current = {}
            onDelete(t)
          }}
        />
      )}
    </Sheet>
  )
}

function EditorForm({
  task,
  lists,
  today,
  locale,
  onChange,
  onDone,
  onDelete,
}: {
  task: Task
  lists: TaskList[]
  today: string
  locale: string
  onChange: (patch: TaskPatch) => void
  onDone: () => void
  onDelete: (task: Task) => void
}) {
  const [f, setFState] = useState<TaskPatch>({})
  const setF = (update: (prev: TaskPatch) => TaskPatch) =>
    setFState((prev) => {
      const next = update(prev)
      onChange(next)
      return next
    })
  const [projects, setProjects] = useState<ProjectOption[] | null>(null)
  const v = { ...task, ...f }
  const set = <K extends keyof TaskPatch>(key: K, value: TaskPatch[K]) => setF((prev) => ({ ...prev, [key]: value }))

  useEffect(() => {
    let alive = true
    getProjectOptions().then((p) => alive && setProjects(p), () => alive && setProjects([]))
    return () => {
      alive = false
    }
  }, [])

  const repeatOptions = v.rrule && !REPEATS.some((r) => r.value === v.rrule)
    ? [...REPEATS, { value: v.rrule, label: repeatLabel(v.rrule, locale) ?? "Custom" }]
    : REPEATS
  const titleMissing = !(v.title ?? "").trim()

  return (
    <form
      className="grid gap-4 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!titleMissing) onDone()
      }}
    >
      <div className="grid gap-2">
        <label htmlFor="task-title" className="sr-only">
          Title
        </label>
        <Input
          id="task-title"
          value={v.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={300}
          aria-invalid={titleMissing}
          className="text-card-title h-11 border-transparent bg-transparent px-1 font-display shadow-none focus-visible:bg-field"
        />
        <label htmlFor="task-notes" className="sr-only">
          Notes
        </label>
        <Textarea
          id="task-notes"
          value={v.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Notes — Markdown works: **bold**, - lists, links"
          rows={4}
          maxLength={20_000}
          className="min-h-24 resize-y"
        />
      </div>

      <fieldset className="grid gap-2">
        <legend className={fieldLabel}>When</legend>
        <div className="flex flex-wrap gap-1.5">
          {quickDates(today).map((q) => (
            <button
              key={q.key}
              type="button"
              aria-pressed={v.dueDate === q.date}
              onClick={() => set("dueDate", q.date)}
              className="text-small h-8 rounded-lg px-2.5 outline-none bg-track hover:bg-accent-500/10 focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {q.label}
            </button>
          ))}
          {v.dueDate && (
            <button
              type="button"
              onClick={() => setF((prev) => ({ ...prev, dueDate: null, dueTime: null, rrule: null }))}
              className="text-small h-8 rounded-lg px-2.5 text-muted-foreground outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <div className="grid gap-1">
            <label htmlFor="task-date" className="text-caption text-muted-foreground">
              Date
            </label>
            <Input
              id="task-date"
              type="date"
              value={v.dueDate ?? ""}
              onChange={(e) => {
                const value = e.target.value || null
                setF((prev) => ({ ...prev, dueDate: value, ...(value ? {} : { dueTime: null, rrule: null }) }))
              }}
              className="h-10 dark:[color-scheme:dark] md:h-9"
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor="task-time" className="text-caption text-muted-foreground">
              Time
            </label>
            <Input
              id="task-time"
              type="time"
              value={v.dueTime ?? ""}
              onChange={(e) => {
                const value = e.target.value || null
                setF((prev) => ({ ...prev, dueTime: value, ...(value && !v.dueDate ? { dueDate: today } : {}) }))
              }}
              className="h-10 tabular-nums dark:[color-scheme:dark] md:h-9"
            />
          </div>
        </div>
        <div className="grid gap-1">
          <label htmlFor="task-repeat" className="text-caption text-muted-foreground">
            Repeat
          </label>
          <select
            id="task-repeat"
            value={v.rrule ?? ""}
            onChange={(e) => {
              const value = e.target.value || null
              setF((prev) => ({ ...prev, rrule: value, ...(value && !v.dueDate ? { dueDate: today } : {}) }))
            }}
            className={selectClass}
          >
            {repeatOptions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className={fieldLabel}>Priority</legend>
        <div className="segmented w-fit" role="radiogroup" aria-label="Priority">
          {taskPriorities.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={v.priority === p}
              onClick={() => set("priority", p as TaskPriority)}
              className={cn(
                "text-small flex h-8 items-center gap-1 rounded-lg px-3 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                v.priority === p && "segment-active text-foreground",
              )}
            >
              {p === "high" && <span className="text-text-accent">!!</span>}
              {p === "low" && <span>!</span>}
              {priorityLabels[p]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor="task-list" className={fieldLabel}>
            List
          </label>
          <select id="task-list" value={v.listId ?? ""} onChange={(e) => set("listId", e.target.value || null)} className={selectClass}>
            <option value="">No list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="task-project" className={fieldLabel}>
            Project
          </label>
          <select
            id="task-project"
            value={v.projectId ?? ""}
            onChange={(e) => set("projectId", e.target.value || null)}
            disabled={projects === null}
            className={selectClass}
          >
            <option value="">{projects === null ? "Loading…" : "None"}</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <GoalPicker taskId={task.id} labelClassName={fieldLabel} />

      <div className="flex items-center gap-2 border-t border-hairline pt-3">
        <Button type="button" variant="ghost" size="lg" className="text-muted-foreground" onClick={() => onDelete(task)}>
          <Trash2 />
          Delete
        </Button>
        {titleMissing && <p className="text-caption text-destructive">Give the task a title.</p>}
        <Button type="submit" size="lg" className="ml-auto min-w-20" disabled={titleMissing}>
          Done
        </Button>
      </div>
    </form>
  )
}
