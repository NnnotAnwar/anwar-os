"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type SaveResult = { ok: true; updatedAt: string } | { ok: false; error: string }

export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string }

type Options<T> = {
  initial: T
  /** Last saved time of the initial value, or null for a draft that was never saved. */
  initialSavedAt: string | null
  save: (value: T) => Promise<SaveResult>
  /** Returns a message when the value can't be saved yet (e.g. missing title), else null. */
  validate?: (value: T) => string | null
  delay?: number
  /** Bind ⌘S / Ctrl+S to save now. Use for single-editor pages only. */
  shortcut?: boolean
}

/**
 * The notes editor's save queue, generalised: edits are debounced, saves are
 * serialized, a full unload warns while something is unsaved, and in-app
 * navigation flushes on unmount.
 */
export function useAutosave<T>({ initial, initialSavedAt, save, validate, delay = 800, shortcut }: Options<T>) {
  const [value, setValue] = useState(initial)
  const [status, setStatus] = useState<AutosaveStatus>(
    initialSavedAt ? { kind: "saved", at: initialSavedAt } : { kind: "idle" },
  )

  const latest = useRef(initial)
  const saved = useRef(initialSavedAt ? initial : null)
  const inFlight = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const saveRef = useRef(save)
  const validateRef = useRef(validate)
  useEffect(() => {
    saveRef.current = save
    validateRef.current = validate
  })

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    while (inFlight.current) await inFlight.current
    const snapshot = latest.current
    if (saved.current !== null && JSON.stringify(snapshot) === JSON.stringify(saved.current)) return
    const problem = validateRef.current?.(snapshot) ?? null
    if (problem) {
      setStatus(saved.current === null ? { kind: "idle" } : { kind: "error", message: problem })
      return
    }

    setStatus({ kind: "saving" })
    const run = async () => {
      try {
        const result = await saveRef.current(snapshot)
        if (!result.ok) {
          setStatus({ kind: "error", message: result.error })
          return
        }
        saved.current = snapshot
        setStatus(latest.current === snapshot ? { kind: "saved", at: result.updatedAt } : { kind: "dirty" })
      } catch {
        setStatus({ kind: "error", message: "Changes weren't saved. Check your connection; they retry on the next edit." })
      }
    }
    inFlight.current = run().finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [])

  const update = useCallback(
    (patch: Partial<T> | ((prev: T) => T)) => {
      const next =
        typeof patch === "function" ? (patch as (prev: T) => T)(latest.current) : { ...latest.current, ...patch }
      latest.current = next
      setValue(next)
      setStatus({ kind: "dirty" })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  /** Marks the current value as saved without sending it (e.g. after a delete). */
  const discard = useCallback(() => {
    clearTimeout(timer.current)
    saved.current = latest.current
  }, [])

  useEffect(() => {
    if (!shortcut) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void flush()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [flush, shortcut])

  const unsaved = status.kind === "dirty" || status.kind === "saving" || status.kind === "error"
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [unsaved])

  useEffect(() => () => void flush(), [flush])

  return { value, update, status, flush, discard }
}
