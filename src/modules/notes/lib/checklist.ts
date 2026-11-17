// Checklists in notes: "- [ ] milk" lines become tappable boxes in the preview.
// Pure text helpers, shared by the editor, the preview and the list.

const TASK = /^(\s*[-*+]\s+)\[( |x|X)\](\s+|$)(.*)$/

export type Task = { line: number; done: boolean; text: string }

/** Every task line in the body, with its line number. */
export function findTasks(body: string): Task[] {
  const tasks: Task[] = []
  body.split("\n").forEach((line, i) => {
    const m = TASK.exec(line)
    if (m) tasks.push({ line: i, done: m[2] !== " ", text: m[4]!.trim() })
  })
  return tasks
}

/** Ticks or unticks the task on `line`; any other line is left as it was. */
export function toggleTask(body: string, line: number): string {
  const lines = body.split("\n")
  const current = lines[line]
  if (current === undefined) return body
  const m = TASK.exec(current)
  if (!m) return body
  lines[line] = `${m[1]}[${m[2] === " " ? "x" : " "}]${m[3]}${m[4]}`
  return lines.join("\n")
}

/** "2/5" for the list row, or null when the note has no checklist. */
export function taskProgress(body: string): { done: number; total: number } | null {
  const tasks = findTasks(body)
  if (!tasks.length) return null
  return { done: tasks.filter((t) => t.done).length, total: tasks.length }
}

export type Segment = { kind: "text"; text: string } | { kind: "tasks"; tasks: Task[] }

/** Splits a body into markdown text and runs of task lines, in order. */
export function segments(body: string): Segment[] {
  const out: Segment[] = []
  const lines = body.split("\n")
  let text: string[] = []
  const flush = () => {
    if (text.join("").trim()) out.push({ kind: "text", text: text.join("\n") })
    text = []
  }
  lines.forEach((line, i) => {
    const m = TASK.exec(line)
    if (!m) {
      text.push(line)
      return
    }
    flush()
    const task = { line: i, done: m[2] !== " ", text: m[4]!.trim() }
    const last = out.at(-1)
    if (last?.kind === "tasks" && last.tasks.at(-1)!.line === i - 1) last.tasks.push(task)
    else out.push({ kind: "tasks", tasks: [task] })
  })
  flush()
  return out
}

/** Words in the body, for the editor's footer. Markdown marks don't count. */
export function countWords(text: string): number {
  const words = text
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/[#>*_`~[\]()-]/g, " ")
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)
  return words?.length ?? 0
}

/**
 * Wraps the selection in a marker (⌘B → **, ⌘I → _). With nothing selected
 * it inserts a pair and puts the cursor between; on an already wrapped
 * selection it unwraps.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
): { value: string; start: number; end: number } {
  const before = value.slice(0, start)
  const selected = value.slice(start, end)
  const after = value.slice(end)
  const len = marker.length
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      value: before.slice(0, -len) + selected + after.slice(len),
      start: start - len,
      end: end - len,
    }
  }
  if (selected.length > 2 * len && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, -len)
    return { value: before + inner + after, start, end: start + inner.length }
  }
  return { value: before + marker + selected + marker + after, start: start + len, end: end + len }
}

/**
 * Enter at the end of a list item continues the list ("- [ ] " stays a
 * checklist); Enter on an empty item ends it. Returns null to let the
 * textarea handle the key.
 */
export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1
  const line = value.slice(lineStart, caret)
  const m = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)[.)]\s+)(.*)$/.exec(line)
  if (!m) return null
  const [, indent, bullet, num, rest] = m
  if (!rest!.trim()) {
    // Empty item: drop the bullet and leave the list.
    const next = value.slice(0, lineStart) + value.slice(caret)
    return { value: next, caret: lineStart }
  }
  const nextBullet = num
    ? `${Number(num) + 1}${bullet!.slice(num.length).replace(/\s+$/, "")} `
    : /\[[ xX]\]/.test(bullet!)
      ? bullet!.replace(/\[[xX]\]/, "[ ]")
      : bullet!
  const insert = `\n${indent}${nextBullet}`
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length }
}
