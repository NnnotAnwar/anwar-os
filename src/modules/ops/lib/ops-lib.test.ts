import { describe, expect, it } from "vitest"
import type { AgentService } from "../schema"
import {
  formatBytes,
  formatDuration,
  memoryLabel,
  needsAttention,
  serviceStatus,
  shortTag,
  sortServices,
  summary,
  uptimeLabel,
} from "./status"
import { ghcrPath, mergeTags } from "./tags"

const svc = (over: Partial<AgentService>): AgentService => ({
  name: "x",
  container: "x-1",
  image: "ghcr.io/o/x",
  tag: "latest",
  state: "running",
  health: "healthy",
  exit_code: 0,
  restart_count: 0,
  protected: false,
  cpu_percent: null,
  mem_bytes: null,
  mem_limit_bytes: null,
  ...over,
})

describe("service status", () => {
  it("reads running containers by their healthcheck", () => {
    expect(serviceStatus(svc({ health: "healthy" }))).toBe("ok")
    expect(serviceStatus(svc({ health: "none" }))).toBe("ok")
    expect(serviceStatus(svc({ health: "starting" }))).toBe("starting")
    expect(serviceStatus(svc({ health: "unhealthy" }))).toBe("attention")
    expect(serviceStatus(svc({ state: "restarting" }))).toBe("attention")
  })

  it("tells a deliberate stop from a crash", () => {
    expect(serviceStatus(svc({ state: "exited", exit_code: 0 }))).toBe("stopped")
    expect(serviceStatus(svc({ state: "exited", exit_code: 143 }))).toBe("stopped")
    expect(serviceStatus(svc({ state: "exited", exit_code: 137 }))).toBe("stopped")
    expect(serviceStatus(svc({ state: "exited", exit_code: 137, oom_killed: true }))).toBe("down")
    expect(serviceStatus(svc({ state: "dead", exit_code: 0 }))).toBe("down")
    expect(serviceStatus(svc({ state: "exited", exit_code: 1 }))).toBe("down")
    expect(needsAttention(svc({ state: "exited", exit_code: 0 }))).toBe(false)
    expect(needsAttention(svc({ state: "exited", exit_code: 2 }))).toBe(true)
    expect(needsAttention(svc({ health: "unhealthy" }))).toBe(true)
  })

  it("summarizes the panel", () => {
    expect(summary([svc({}), svc({})])).toBe("All 2 services running")
    expect(summary([svc({}), svc({ health: "unhealthy" })])).toBe("1 of 2 needs attention")
    expect(summary([])).toBe("No managed services yet")
  })

  it("puts what needs attention first, then bots, app, edge, data", () => {
    const list = [
      svc({ name: "db", role: "data" }),
      svc({ name: "web", role: "app" }),
      svc({ name: "caddy", role: "edge", health: "unhealthy" }),
      svc({ name: "bot-expenses", role: "bot" }),
    ]
    expect(sortServices(list).map((s) => s.name)).toEqual(["caddy", "bot-expenses", "web", "db"])
  })
})

describe("formatting", () => {
  it("formats durations with the two largest units", () => {
    expect(formatDuration(40_000)).toBe("40 s")
    expect(formatDuration(12 * 60_000 + 5_000)).toBe("12 min 5 s")
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000 + 60_000)).toBe("3 d 4 h")
    expect(formatDuration(0)).toBe("0 s")
    expect(formatDuration(-5)).toBe("0 s")
  })

  it("labels uptime and downtime", () => {
    const now = new Date("2026-11-16T12:00:00Z")
    expect(uptimeLabel(svc({ started_at: "2026-11-16T10:00:00Z" }), now)).toBe("up 2 h")
    expect(uptimeLabel(svc({ state: "exited", finished_at: "2026-11-16T11:48:00Z" }), now)).toBe("stopped 12 min ago")
    expect(uptimeLabel(svc({}), now)).toBeNull()
  })

  it("formats bytes and memory", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(128 * 1024 * 1024)).toBe("128 MB")
    expect(memoryLabel(svc({ mem_bytes: 50 * 1024 * 1024, mem_limit_bytes: 128 * 1024 * 1024 }))).toBe("50.0 MB / 128 MB")
    expect(memoryLabel(svc({}))).toBeNull()
  })

  it("shortens sha tags only", () => {
    expect(shortTag("a".repeat(40))).toBe("aaaaaaa")
    expect(shortTag("latest")).toBe("latest")
    expect(shortTag("v1.2")).toBe("v1.2")
  })
})

describe("image tags", () => {
  it("knows GHCR images", () => {
    expect(ghcrPath("ghcr.io/nnnotanwar/anwar-os-web")).toBe("nnnotanwar/anwar-os-web")
    expect(ghcrPath("postgres")).toBeNull()
    expect(ghcrPath("caddy")).toBeNull()
  })

  it("matches sha tags to commits, newest first, latest last", () => {
    const a = "a".repeat(40)
    const b = "b".repeat(40)
    const c = "c".repeat(40)
    const tags = ["latest", a, b, c, "v1"]
    const commits = [
      { sha: b, message: "Newest change\n\nbody", date: "2026-11-16T10:00:00Z" },
      { sha: a, message: "Older change", date: "2026-11-15T10:00:00Z" },
    ]
    const list = mergeTags(tags, commits, a)
    expect(list.map((t) => t.tag)).toEqual([b, a, "v1", "latest"])
    expect(list[0]).toMatchObject({ message: "Newest change", current: false })
    expect(list[1]!.current).toBe(true)
  })

  it("keeps the running tag visible beyond the limit", () => {
    const shas = Array.from({ length: 5 }, (_, i) => String(i).repeat(40))
    const commits = shas.map((sha, i) => ({ sha, message: `c${i}`, date: `2026-11-1${i}T00:00:00Z` }))
    const list = mergeTags(shas, commits, shas[4]!, 2)
    expect(list.map((t) => t.tag)).toEqual([shas[0], shas[1], shas[4]])
    expect(list.at(-1)!.current).toBe(true)
  })
})
