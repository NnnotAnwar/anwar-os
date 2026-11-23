import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type ToastOptions = {
  action: { onClick: () => void }
  onAutoClose: () => void
  onDismiss: () => void
}

const sonner = vi.hoisted(() => {
  const state: { last?: ToastOptions } = {}
  return {
    state,
    toast: {
      success: vi.fn((_message: string, options: ToastOptions) => {
        state.last = options
        return "t1"
      }),
      error: vi.fn(),
      dismiss: vi.fn(() => state.last?.onDismiss()),
    },
  }
})
vi.mock("sonner", () => ({ toast: sonner.toast }))

const { removeWithUndo } = await import("./undo-toast")

// No DOM in this test run: the helper only needs pagehide / visibilitychange.
const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState })
const win = new EventTarget()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("window", win)
  vi.stubGlobal("document", doc)
  doc.visibilityState = "visible"
  sonner.state.last = undefined
  vi.clearAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(commit: () => Promise<{ ok: boolean; error?: string } | void> = async () => ({ ok: true })) {
  const calls = { hide: 0, restore: 0, commit: 0 }
  removeWithUndo({
    message: "Deleted",
    hide: () => void calls.hide++,
    restore: () => void calls.restore++,
    commit: () => {
      calls.commit++
      return commit()
    },
  })
  return calls
}

describe("removeWithUndo", () => {
  it("commits when the window ends even if the toast never closes by itself (paused on a phone)", async () => {
    const calls = setup()
    expect(calls).toEqual({ hide: 1, restore: 0, commit: 0 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.commit).toBe(1)
    expect(calls.restore).toBe(0)
  })

  it("commits once when both the toast and the timer finish", async () => {
    const calls = setup()
    sonner.state.last!.onAutoClose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.commit).toBe(1)
  })

  it("Undo restores and never commits", async () => {
    const calls = setup()
    sonner.state.last!.action.onClick()
    sonner.state.last!.onDismiss() // Sonner closes the toast after the action
    await vi.advanceTimersByTimeAsync(10_000)
    win.dispatchEvent(new Event("pagehide"))
    expect(calls).toEqual({ hide: 1, restore: 1, commit: 0 })
  })

  it("commits at once when the page goes away or the app is backgrounded", async () => {
    const first = setup()
    win.dispatchEvent(new Event("pagehide"))
    expect(first.commit).toBe(1)

    const second = setup()
    doc.visibilityState = "hidden"
    doc.dispatchEvent(new Event("visibilitychange"))
    expect(second.commit).toBe(1)
    expect(first.commit).toBe(1) // listeners of the first one are gone
  })

  it("puts the item back and says so when the write fails or throws", async () => {
    const failed = setup(async () => ({ ok: false, error: "Nope" }))
    await vi.advanceTimersByTimeAsync(5000)
    expect(failed.restore).toBe(1)
    expect(sonner.toast.error).toHaveBeenLastCalledWith("Nope")

    const threw = setup(async () => {
      throw new Error("Failed to find Server Action")
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(threw.restore).toBe(1)
    expect(sonner.toast.error).toHaveBeenCalledTimes(2)
  })
})
