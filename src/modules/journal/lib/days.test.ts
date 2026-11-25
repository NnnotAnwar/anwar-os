import { describe, expect, it } from "vitest"
import { addDays, heatMap, monthStats, weekdayIndex } from "./days"
import { formatDayLong, formatDayShort } from "./format"

describe("format", () => {
  it("spells days the same way the bot parses them back", () => {
    expect(formatDayLong("2026-11-24")).toBe("Tuesday 24 Nov")
    expect(formatDayShort("2026-11-24", 2026)).toBe("Tue 24 Nov")
    expect(formatDayShort("2025-03-05", 2026)).toBe("Wed 5 Mar 2025")
    expect(formatDayShort("2026-11-24", 0)).toBe("Tue 24 Nov 2026")
  })
})

describe("journal days", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(weekdayIndex("2026-11-23")).toBe(0) // Monday
    expect(weekdayIndex("2026-11-29")).toBe(6) // Sunday
  })
})

describe("heatMap", () => {
  const map = heatMap(
    2026,
    [
      { day: "2026-01-01", mood: 4, hasText: true },
      { day: "2026-11-25", mood: null, hasText: true },
    ],
    "2026-11-25",
  )

  it("lays the year out in Monday-first weeks", () => {
    // 1 Jan 2026 is a Thursday: the first column starts on Monday 29 Dec 2025.
    expect(map.weeks[0]!.slice(0, 3)).toEqual([null, null, null])
    expect(map.weeks[0]![3]).toEqual({ day: "2026-01-01", mood: 4, hasText: true, future: false })
    expect(map.weeks.every((w) => w.length === 7)).toBe(true)
    const cells = map.weeks.flat().filter((c) => c !== null)
    expect(cells).toHaveLength(365)
    expect(cells.at(-1)!.day).toBe("2026-12-31")
    // 31 Dec 2026 is a Thursday: the last column ends with three blanks.
    expect(map.weeks.at(-1)!.slice(4)).toEqual([null, null, null])
  })

  it("marks entries, lines without a mood and days still to come", () => {
    const cells = new Map(map.weeks.flat().filter((c) => c !== null).map((c) => [c.day, c]))
    expect(cells.get("2026-11-25")).toEqual({ day: "2026-11-25", mood: null, hasText: true, future: false })
    expect(cells.get("2026-11-26")).toMatchObject({ mood: null, hasText: false, future: true })
  })

  it("labels each month over the column holding its 1st", () => {
    expect(map.months).toHaveLength(12)
    expect(map.months[0]).toEqual({ label: "Jan", column: 0 })
    // 1 Feb 2026 is a Sunday, in the column of Monday 26 Jan (the 5th column).
    expect(map.months[1]).toEqual({ label: "Feb", column: 4 })
  })
})

describe("monthStats", () => {
  it("counts days written, averages the mood and finds the best and worst day", () => {
    const stats = monthStats("2026-11", [
      { day: "2026-11-03", mood: 2, text: "Rain" },
      { day: "2026-11-01", mood: 5, text: "Hike" },
      { day: "2026-11-10", mood: 5, text: "Again" },
      { day: "2026-11-12", mood: null, text: "Just a line" },
      { day: "2026-11-20", mood: 4, text: "" },
    ])
    expect(stats).toEqual({
      month: "2026-11",
      written: 5,
      rated: 4,
      averageMood: 4,
      best: { day: "2026-11-01", mood: 5, text: "Hike" },
      worst: { day: "2026-11-03", mood: 2, text: "Rain" },
    })
  })

  it("rounds the average to one decimal and has no worst day when every mood was the same", () => {
    expect(monthStats("2026-11", [{ day: "2026-11-01", mood: 3, text: "" }, { day: "2026-11-02", mood: 3, text: "" }, { day: "2026-11-03", mood: 4, text: "" }]).averageMood).toBe(3.3)
    const same = monthStats("2026-11", [{ day: "2026-11-01", mood: 3, text: "" }, { day: "2026-11-02", mood: 3, text: "" }])
    expect(same.best).toEqual({ day: "2026-11-01", mood: 3, text: "" })
    expect(same.worst).toBeNull()
  })

  it("is empty without entries, and without a mood there is no average", () => {
    expect(monthStats("2026-11", [])).toEqual({ month: "2026-11", written: 0, rated: 0, averageMood: null, best: null, worst: null })
    expect(monthStats("2026-11", [{ day: "2026-11-01", mood: null, text: "x" }])).toMatchObject({ written: 1, averageMood: null, best: null })
  })
})
