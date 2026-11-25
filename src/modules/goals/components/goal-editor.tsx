"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, ArrowUpRight, CheckCircle, Minus, Plus, Trash2, X } from "@/components/icons"
import { NAV_BACK } from "@/components/motion"
import { Field, fieldClass, SaveStatus, Toggle } from "@/components/editor-fields"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAutosave } from "@/lib/use-autosave"
import { cn } from "@/lib/utils"
import { goalProgress } from "../lib/progress"
import { goalStatusLabels, type Goal, type GoalDetail, type GoalProject, type GoalStatus, type GoalTask } from "../schema"
import {
  addTaskToGoal,
  deleteGoalAndReturn,
  linkToGoal,
  logGoalProgress,
  saveGoal,
  setGoalOnNow,
  setGoalProgress,
  setGoalStatus,
} from "../server-actions"
import { ProgressBar, ProgressLine } from "./goal-progress"

type Measure = "tasks" | "number"
type Form = { title: string; why: string; year: number; measure: Measure; target: string; unit: string }

function toForm(goal: GoalDetail | null, year: number): Form {
  return {
    title: goal?.title ?? "",
    why: goal?.why ?? "",
    year: goal?.year ?? year,
    measure: goal?.targetValue != null ? "number" : "tasks",
    target: goal?.targetValue != null ? String(goal.targetValue) : "",
    unit: goal?.targetUnit ?? "",
  }
}

/** "12,5" and "12.5" both mean twelve and a half. */
export function parseAmount(text: string) {
  const n = Number(text.trim().replace(",", "."))
  return text.trim() && Number.isFinite(n) ? n : null
}

/** Whole numbers stay whole; no grouping, so the field reads back as typed. */
function plain(n: number) {
  return String(Math.round(n * 100) / 100)
}

/**
 * One editor for new and existing goals, autosaving like ideas: created once it
 * has a title, then the URL switches to it in place. Progress and status apply
 * at once (the frequent actions); the bar follows the form as you type.
 */
export function GoalEditor({
  goal,
  thisYear,
  defaultYear,
  elapsed,
  timezone,
  locale,
}: {
  goal: GoalDetail | null
  thisYear: number
  /** A new goal's year (the year being planned); default this year. */
  defaultYear?: number
  elapsed: number | null
  timezone: string
  locale: string
}) {
  const idRef = useRef<string | null>(goal?.id ?? null)
  const [id, setId] = useState<string | null>(goal?.id ?? null)
  const [pending, startTransition] = useTransition()

  // Changed on this page without a reload; a refresh (after linking tasks)
  // brings the server's numbers back.
  const [live, setLive] = useState({ currentValue: goal?.currentValue ?? 0, status: goal?.status ?? ("active" as GoalStatus) })
  const [synced, setSynced] = useState(goal)
  if (goal !== synced) {
    setSynced(goal)
    if (goal) setLive({ currentValue: goal.currentValue, status: goal.status })
  }

  const { value, update, status, flush, discard } = useAutosave<Form>({
    initial: toForm(goal, defaultYear ?? thisYear),
    initialSavedAt: goal?.updatedAt ?? null,
    shortcut: true,
    validate: (v) => {
      if (!v.title.trim()) return "A goal needs a title before it can save."
      if (v.measure === "number") {
        const n = parseAmount(v.target)
        if (n === null || n <= 0) return "Enter a target above zero, e.g. 20."
      }
      return null
    },
    save: async (v) => {
      const result = await saveGoal(idRef.current, {
        title: v.title,
        why: v.why,
        year: v.year,
        targetValue: v.measure === "number" ? parseAmount(v.target) : null,
        targetUnit: v.measure === "number" ? v.unit : "",
      })
      if (!result.ok) return result
      if (!idRef.current) {
        idRef.current = result.id
        setId(result.id)
        window.history.replaceState(null, "", `/app/goals/${result.id}`)
      }
      return { ok: true, updatedAt: result.updatedAt }
    },
  })

  const years = Array.from(new Set([thisYear - 1, thisYear, thisYear + 1, thisYear + 2, value.year])).sort()

  function remove() {
    if (!id) return
    discard()
    startTransition(async () => {
      await deleteGoalAndReturn({ id })
      toast.success("Goal deleted")
    })
  }

  function changeStatus(next: GoalStatus, message: string) {
    if (!id) return
    setLive((l) => ({ ...l, status: next }))
    startTransition(async () => {
      await setGoalStatus({ id, status: next })
      toast.success(message)
    })
  }

  // What the progress card shows, from the form as typed: no save round trip.
  const typedTarget = value.measure === "number" ? parseAmount(value.target) : null
  const target = typedTarget !== null && typedTarget > 0 ? typedTarget : null
  const shown: Goal | null = id
    ? {
        id,
        year: value.year,
        title: value.title,
        why: value.why,
        targetValue: target,
        targetUnit: value.unit,
        currentValue: live.currentValue,
        status: live.status,
        sortOrder: goal?.sortOrder ?? 0,
        tasksDone: goal?.tasksDone ?? 0,
        tasksTotal: goal?.tasksTotal ?? 0,
        projectCount: goal?.projectCount ?? 0,
        showOnNow: goal?.showOnNow ?? false,
        progress: goalProgress({
          status: live.status,
          targetValue: target,
          targetUnit: value.unit,
          currentValue: live.currentValue,
          tasksDone: goal?.tasksDone ?? 0,
          tasksTotal: goal?.tasksTotal ?? 0,
        }),
        createdAt: goal?.createdAt ?? "",
        updatedAt: goal?.updatedAt ?? "",
      }
    : null

  return (
    <article className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex min-h-9 items-center gap-2">
        <Link
          href="/app/goals"
          transitionTypes={NAV_BACK}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}
        >
          <ArrowLeft />
          Goals
        </Link>
        <SaveStatus
          status={status}
          idleText="Saves as you type once it has a title"
          timezone={timezone}
          locale={locale}
          className="min-w-0 flex-1"
        />
        {id && (
          <Button variant="ghost" size="icon" onClick={remove} disabled={pending} aria-label="Delete goal">
            <Trash2 />
          </Button>
        )}
      </div>

      <div className="glass grid gap-4 rounded-xl p-4 md:p-6">
        <label htmlFor="goal-title" className="sr-only">
          Goal
        </label>
        <input
          id="goal-title"
          value={value.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="What do you want to achieve?"
          maxLength={120}
          autoFocus={!goal}
          autoComplete="off"
          className="w-full bg-transparent font-display text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60"
        />
        <Field label="Why it matters" hint="One or two sentences. Read it again when it gets hard.">
          {(fid) => (
            <textarea
              id={fid}
              value={value.why}
              onChange={(e) => update({ why: e.target.value })}
              maxLength={1000}
              rows={2}
              placeholder="e.g. To think more clearly and sleep better."
              className={cn(fieldClass, "field-sizing-content h-auto min-h-16 resize-none py-2 leading-6")}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Field label="Year">
            {(fid) => (
              <select id={fid} value={value.year} onChange={(e) => update({ year: Number(e.target.value) })} className={fieldClass}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="grid content-start gap-1.5">
            <legend className="text-small mb-1.5 text-muted-foreground">Measured by</legend>
            <div className="segmented w-fit" role="radiogroup" aria-label="Measured by">
              {(
                [
                  ["tasks", "Linked tasks"],
                  ["number", "A number"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={value.measure === m}
                  onClick={() => update({ measure: m })}
                  className={cn(
                    "text-small flex h-9 items-center rounded-lg px-3 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8",
                    value.measure === m && "segment-active text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {value.measure === "number" ? (
          <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3">
            <Field label="Target">
              {(fid) => (
                <input
                  id={fid}
                  inputMode="decimal"
                  value={value.target}
                  onChange={(e) => update({ target: e.target.value })}
                  placeholder="20"
                  autoComplete="off"
                  className={cn(fieldClass, "tabular-nums")}
                />
              )}
            </Field>
            <Field label="Unit" hint="Plural, as you'd say it: books, km, workouts.">
              {(fid) => (
                <input
                  id={fid}
                  value={value.unit}
                  onChange={(e) => update({ unit: e.target.value })}
                  placeholder="books"
                  maxLength={30}
                  autoComplete="off"
                  className={fieldClass}
                />
              )}
            </Field>
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">
            Progress is the share of linked tasks that are done. Add tasks below, or open a task or project and choose this
            goal under Goal.
          </p>
        )}
      </div>

      {id && shown && (
        <>
          <ProgressCard
            id={id}
            goal={shown}
            measured={target !== null}
            elapsed={value.year === thisYear ? elapsed : null}
            locale={locale}
            flush={flush}
            onProgress={(g) => setLive({ currentValue: g.currentValue, status: g.status })}
            onStatus={changeStatus}
            disabled={pending}
          />
          <LinkedCard goalId={id} tasks={goal?.tasks ?? []} projects={goal?.projects ?? []} />
          <NowCard
            key={id}
            id={id}
            initial={goal?.showOnNow ?? false}
            thisYear={value.year === thisYear}
            dropped={live.status === "dropped"}
          />
        </>
      )}
    </article>
  )
}

function ProgressCard({
  id,
  goal,
  measured,
  elapsed,
  locale,
  flush,
  onProgress,
  onStatus,
  disabled,
}: {
  id: string
  goal: Goal
  measured: boolean
  elapsed: number | null
  locale: string
  /** Saves a just-typed target first, so the server counts against it. */
  flush: () => Promise<void>
  onProgress: (goal: Goal) => void
  onStatus: (status: GoalStatus, message: string) => void
  disabled: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<string | null>(null)

  function log(by: number) {
    startTransition(async () => {
      await flush()
      const result = await logGoalProgress({ id, by })
      if (!result.ok) return void toast.error(result.error)
      onProgress(result.goal)
    })
  }

  function commitDraft() {
    if (draft === null) return
    const n = parseAmount(draft)
    setDraft(null)
    if (n === null || n < 0 || n === goal.currentValue) return
    startTransition(async () => {
      await flush()
      const result = await setGoalProgress({ id, value: n })
      if (!result.ok) return void toast.error(result.error)
      onProgress(result.goal)
    })
  }

  return (
    <section aria-labelledby="goal-progress" className="glass grid gap-3 rounded-xl p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="goal-progress" className="text-card-title">
          Progress
        </h2>
        {goal.status !== "active" && (
          <span className="text-micro rounded-full bg-track px-2 py-1 text-muted-foreground">{goalStatusLabels[goal.status]}</span>
        )}
      </div>
      <ProgressBar goal={goal} elapsed={elapsed} className="h-2" />
      <ProgressLine goal={goal} elapsed={elapsed} locale={locale} className="text-meta" />
      {measured && goal.status === "active" && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 md:size-9"
            onClick={() => log(-1)}
            disabled={pending || goal.currentValue <= 0}
            aria-label="Take one off"
          >
            <Minus />
          </Button>
          <label htmlFor="goal-current" className="sr-only">
            Done so far
          </label>
          <Input
            id="goal-current"
            inputMode="decimal"
            value={draft ?? plain(goal.currentValue)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commitDraft()
              }
            }}
            className="h-11 w-24 text-center tabular-nums md:h-9"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => log(1)}
            disabled={pending}
            aria-label="Log one more"
          >
            <Plus />1
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
        {goal.status === "active" ? (
          <>
            <Button type="button" variant="outline" onClick={() => onStatus("done", "Goal achieved")} disabled={disabled}>
              <CheckCircle />
              Mark achieved
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => onStatus("dropped", "Goal dropped")}
              disabled={disabled}
            >
              <X />
              Drop
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={() => onStatus("active", "Goal active again")} disabled={disabled}>
            Make active again
          </Button>
        )}
      </div>
    </section>
  )
}

function LinkedCard({ goalId, tasks, projects }: { goalId: string; tasks: GoalTask[]; projects: GoalProject[] }) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const open = tasks.filter((t) => !t.doneAt)
  const done = tasks.filter((t) => t.doneAt)

  function add(e: React.FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return setError("Write the task first — a few words are enough.")
    startTransition(async () => {
      const result = await addTaskToGoal({ goalId, text: value })
      if (!result.ok) return setError(result.error)
      setText("")
      setError(null)
      toast.success("Task added to this goal")
      router.refresh()
    })
  }

  function unlink(kind: "task" | "project", id: string, title: string) {
    startTransition(async () => {
      const result = await linkToGoal(kind === "task" ? { goalId: null, taskId: id } : { goalId: null, projectId: id })
      if (!result.ok) return void toast.error(result.error)
      toast.success(`“${title}” no longer counts towards this goal`)
      router.refresh()
    })
  }

  const rowClass =
    "-mx-2 flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"

  return (
    <section aria-labelledby="goal-linked" className="glass grid gap-3 rounded-xl p-4 md:p-6">
      <h2 id="goal-linked" className="text-card-title">
        Tasks and projects
      </h2>

      <form onSubmit={add} className="grid gap-1.5" aria-label="Add a task to this goal">
        <div className="flex gap-2">
          <label htmlFor="goal-task" className="sr-only">
            New task for this goal
          </label>
          <Input
            id="goal-task"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
            placeholder="Add a task, e.g. Sign up for the race friday"
            maxLength={500}
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "goal-task-error" : undefined}
            className="h-10 md:h-9"
          />
          <Button type="submit" disabled={pending} className="h-10 md:h-9">
            <Plus />
            Add
          </Button>
        </div>
        {error && (
          <p id="goal-task-error" role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}
      </form>

      {projects.length > 0 && (
        <ul className="grid gap-0.5" aria-label="Linked projects">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Link href={`/app/projects/${p.id}`} className={rowClass}>
                <span className="text-micro rounded-full bg-track px-2 py-0.5 text-muted-foreground">Project</span>
                <span className="text-body truncate">{p.title}</span>
              </Link>
              <UnlinkButton label={`Unlink ${p.title}`} onClick={() => unlink("project", p.id, p.title)} disabled={pending} />
            </li>
          ))}
        </ul>
      )}

      {tasks.length > 0 ? (
        <ul className="grid gap-0.5" aria-label="Tasks counting towards this goal">
          {[...open, ...done].map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <Link href={`/app/tasks?task=${t.id}`} className={rowClass}>
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                    t.doneAt ? "border-primary bg-primary" : "border-muted-foreground/50",
                  )}
                />
                <span className="grid min-w-0">
                  <span className={cn("text-body truncate", t.doneAt && "text-muted-foreground line-through")}>
                    <span className="sr-only">{t.doneAt ? "Done: " : "Open: "}</span>
                    {t.title}
                  </span>
                  {t.viaProject && <span className="text-caption truncate text-muted-foreground">via {t.viaProject}</span>}
                </span>
              </Link>
              {!t.viaProject && (
                <UnlinkButton label={`Unlink ${t.title}`} onClick={() => unlink("task", t.id, t.title)} disabled={pending} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-muted-foreground">
          No tasks yet. Add one above, or open a task or project and choose this goal under Goal.
        </p>
      )}
    </section>
  )
}

/**
 * "Show on /now": goals are private until the owner turns this on. Applies at
 * once (no autosave round), and says when the goal won't show anyway.
 */
function NowCard({ id, initial, thisYear, dropped }: { id: string; initial: boolean; thisYear: boolean; dropped: boolean }) {
  const [on, setOn] = useState(initial)
  const [pending, startTransition] = useTransition()

  function change(next: boolean) {
    setOn(next)
    startTransition(async () => {
      const result = await setGoalOnNow({ id, value: next })
      if (!result.ok) {
        setOn(!next)
        toast.error(result.error)
        return
      }
      toast.success(next ? "Shown on /now" : "Hidden from /now")
    })
  }

  const note = !on
    ? "Private. Turn it on to list this goal on your public /now page."
    : dropped
      ? "Dropped goals never show on /now."
      : !thisYear
        ? "Only this year's goals show on /now; this one will in its own year."
        : "Visitors see the title and progress on /now. Never the why or the tasks."

  return (
    <section aria-labelledby="goal-now" className="glass grid gap-3 rounded-xl p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="goal-now" className="text-card-title">
          On your site
        </h2>
        <a
          href="/now"
          target="_blank"
          rel="noreferrer"
          className="text-meta -my-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0"
        >
          Open /now
          <ArrowUpRight className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <Toggle checked={on} onChange={change} disabled={pending} label="Show on /now" description={note} />
    </section>
  )
}

function UnlinkButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 text-muted-foreground md:size-9"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <X />
    </Button>
  )
}
