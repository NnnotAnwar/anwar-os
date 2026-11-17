import { describe, expect, it } from "vitest"
import { continueList, countWords, findTasks, segments, taskProgress, toggleTask, wrapSelection } from "./checklist"

const body = "Shopping\n- [ ] Oat milk\n- [x] Eggs\n* [X] Bread\nnot a task [ ]\n- plain bullet"

describe("checklists", () => {
  it("finds task lines in any bullet style", () => {
    expect(findTasks(body)).toEqual([
      { line: 1, done: false, text: "Oat milk" },
      { line: 2, done: true, text: "Eggs" },
      { line: 3, done: true, text: "Bread" },
    ])
  })
  it("toggles only the given line", () => {
    const once = toggleTask(body, 1)
    expect(once.split("\n")[1]).toBe("- [x] Oat milk")
    expect(toggleTask(once, 1)).toBe(body)
    expect(toggleTask(body, 0)).toBe(body)
    expect(toggleTask(body, 99)).toBe(body)
  })
  it("counts progress", () => {
    expect(taskProgress(body)).toEqual({ done: 2, total: 3 })
    expect(taskProgress("no tasks")).toBeNull()
  })
  it("splits text and task runs", () => {
    const s = segments(body)
    expect(s.map((x) => x.kind)).toEqual(["text", "tasks", "text"])
    expect(s[1]!.kind === "tasks" && s[1]!.tasks.length).toBe(3)
  })
})

describe("countWords", () => {
  it("ignores markdown marks", () => {
    expect(countWords("## Hello **world**\n- [ ] buy milk")).toBe(4)
    expect(countWords("")).toBe(0)
    expect(countWords("Přílohy a čísla 2026")).toBe(4)
  })
})

describe("wrapSelection", () => {
  it("wraps and keeps the selection on the word", () => {
    expect(wrapSelection("say hi now", 4, 6, "**")).toEqual({ value: "say **hi** now", start: 6, end: 8 })
  })
  it("unwraps when already wrapped", () => {
    expect(wrapSelection("say **hi** now", 6, 8, "**")).toEqual({ value: "say hi now", start: 4, end: 6 })
  })
  it("inserts an empty pair at the caret", () => {
    expect(wrapSelection("ab", 1, 1, "_")).toEqual({ value: "a__b", start: 2, end: 2 })
  })
})

describe("continueList", () => {
  it("continues a checklist unticked", () => {
    expect(continueList("- [x] milk", 10)).toEqual({ value: "- [x] milk\n- [ ] ", caret: 17 })
  })
  it("continues bullets and numbers", () => {
    expect(continueList("- a", 3)?.value).toBe("- a\n- ")
    expect(continueList("1. a", 4)?.value).toBe("1. a\n2. ")
  })
  it("ends the list on an empty item", () => {
    expect(continueList("- a\n- ", 6)).toEqual({ value: "- a\n", caret: 4 })
  })
  it("leaves plain lines alone", () => {
    expect(continueList("hello", 5)).toBeNull()
  })
})
