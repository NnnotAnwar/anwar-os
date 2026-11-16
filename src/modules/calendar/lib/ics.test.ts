import { describe, expect, it } from "vitest"
import { escapeText, foldLine, serializeCalendar, transitionsInYear, vtimezone, type IcsEvent } from "./ics"

const base: IcsEvent = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Standup",
  notes: "",
  location: "",
  category: "Work",
  start: new Date("2026-11-16T08:00:00Z"),
  end: new Date("2026-11-16T08:15:00Z"),
  allDay: false,
  timezone: "Europe/Prague",
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  reminders: [],
  createdAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-02T10:00:00Z"),
}
const now = new Date("2026-11-16T12:34:56Z")

const unfold = (ics: string) => ics.replace(/\r\n /g, "")
const lines = (ics: string) => unfold(ics).split("\r\n")

describe("escapeText", () => {
  it("escapes backslashes, separators and newlines", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf")
  })
})

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:Hi")).toBe("SUMMARY:Hi")
  })

  it("folds at 75 octets with a leading space on continuations", () => {
    const folded = foldLine(`DESCRIPTION:${"x".repeat(200)}`)
    const parts = folded.split("\r\n")
    expect(parts[0]).toHaveLength(75)
    for (const part of parts.slice(1)) {
      expect(part.startsWith(" ")).toBe(true)
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    }
    expect(unfold(folded)).toBe(`DESCRIPTION:${"x".repeat(200)}`)
  })

  it("never splits a multi-byte character", () => {
    const text = `SUMMARY:${"Příliš žluťoučký kůň 🐎 ".repeat(8)}`
    const folded = foldLine(text)
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
      expect(part).not.toContain("�")
    }
    expect(unfold(folded)).toBe(text)
  })
})

describe("VTIMEZONE", () => {
  it("finds Prague's two transitions in 2026", () => {
    const t = transitionsInYear("Europe/Prague", 2026)
    expect(t.map((x) => [x.at.toISOString(), x.from, x.to])).toEqual([
      ["2026-03-29T01:00:00.000Z", 60, 120],
      ["2026-10-25T01:00:00.000Z", 120, 60],
    ])
  })

  it("describes Prague as last-Sunday rules anchored in 1970", () => {
    expect(vtimezone("Europe/Prague", 2026)).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Prague",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700329T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:19701025T030000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "END:VTIMEZONE",
    ])
  })

  it("uses nth-weekday rules where they apply (New York: 2nd Sunday of March)", () => {
    const tz = vtimezone("America/New_York", 2026)
    expect(tz).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU")
    expect(tz).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU")
    expect(tz).toContain("TZOFFSETTO:-0400")
  })

  it("gives zones without DST a single STANDARD", () => {
    expect(vtimezone("Asia/Tokyo", 2026)).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Tokyo",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "END:STANDARD",
      "END:VTIMEZONE",
    ])
  })
})

describe("serializeCalendar", () => {
  const ics = serializeCalendar({
    name: "anwar.os",
    host: "anwar.os",
    now,
    events: [
      { ...base, reminders: [10, 0], location: "Room 2; floor 3", notes: "Agenda:\n- one, two" },
      {
        ...base,
        id: "66666666-7777-8888-9999-000000000000",
        title: "Mom's birthday",
        category: "Birthday",
        allDay: true,
        start: new Date("2026-05-04T00:00:00Z"),
        end: new Date("2026-05-05T00:00:00Z"),
        rrule: "FREQ=YEARLY",
      },
    ],
  })

  it("uses CRLF everywhere and ends with one", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true)
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/)
  })

  it("wraps everything in a VCALENDAR with one VTIMEZONE per zone used", () => {
    const l = lines(ics)
    expect(l.slice(0, 4)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//anwar.os//Calendar//EN", "CALSCALE:GREGORIAN"])
    expect(l.filter((x) => x === "BEGIN:VTIMEZONE")).toHaveLength(1)
    expect(l.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(2)
  })

  it("writes a timed recurring event in its zone", () => {
    const l = lines(ics)
    expect(l).toContain("UID:11111111-2222-3333-4444-555555555555@anwar.os")
    expect(l).toContain("DTSTAMP:20261116T123456Z")
    expect(l).toContain("DTSTART;TZID=Europe/Prague:20261116T090000")
    expect(l).toContain("DTEND;TZID=Europe/Prague:20261116T091500")
    expect(l).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO")
    expect(l).toContain("LOCATION:Room 2\\; floor 3")
    expect(l).toContain("DESCRIPTION:Agenda:\\n- one\\, two")
  })

  it("adds an alarm per reminder", () => {
    const l = lines(ics)
    expect(l).toContain("TRIGGER:-PT10M")
    expect(l).toContain("TRIGGER:PT0M")
    expect(l.filter((x) => x === "BEGIN:VALARM")).toHaveLength(2)
  })

  it("writes all-day events as dates with an exclusive end", () => {
    const l = lines(ics)
    expect(l).toContain("DTSTART;VALUE=DATE:20260504")
    expect(l).toContain("DTEND;VALUE=DATE:20260505")
    expect(l).toContain("RRULE:FREQ=YEARLY")
    expect(l).toContain("SUMMARY:Mom's birthday")
  })

  it("keeps every physical line within 75 octets", () => {
    const long = serializeCalendar({ name: "x", host: "anwar.os", now, events: [{ ...base, notes: "word ".repeat(100) }] })
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })
})
