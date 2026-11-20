import { describe, expect, it } from "vitest"
import { deliveryKey, dueReminders, parseDeliveryKey, type ReminderEvent } from "./reminders"

const TZ = "Europe/Prague"
const ID = "11111111-1111-4111-8111-111111111111"
const ID2 = "22222222-2222-4222-8222-222222222222"

function event(over: Partial<ReminderEvent> = {}): ReminderEvent {
  return {
    id: ID,
    title: "Dentist",
    location: "Vinohradská 1",
    // 14:00 Prague (UTC+1 in November).
    startAt: new Date("2026-11-16T13:00:00Z"),
    endAt: new Date("2026-11-16T14:00:00Z"),
    allDay: false,
    timezone: TZ,
    rrule: null,
    ...over,
  }
}

const at = (iso: string) => new Date(iso)

describe("dueReminders", () => {
  it("fires a reminder once its time has come, with the local clock time", () => {
    const base = { events: [event()], reminders: [{ eventId: ID, minutesBefore: 30 }], delivered: new Set<string>(), ownerTimezone: TZ }
    expect(dueReminders({ ...base, until: at("2026-11-16T12:29:00Z"), now: at("2026-11-16T12:29:00Z") })).toEqual([])

    const due = dueReminders({ ...base, until: at("2026-11-16T12:30:00Z"), now: at("2026-11-16T12:30:00Z") })
    expect(due).toEqual([
      {
        keys: [deliveryKey(ID, at("2026-11-16T13:00:00Z"), 30)],
        eventId: ID,
        title: "Dentist",
        location: "Vinohradská 1",
        allDay: false,
        start: "2026-11-16T13:00:00.000Z",
        end: "2026-11-16T14:00:00.000Z",
        minutesBefore: 30,
        dueAt: "2026-11-16T12:30:00.000Z",
        when: "14:00",
      },
    ])
  })

  it("is idempotent: delivered keys are not returned again", () => {
    const input = {
      events: [event()],
      reminders: [{ eventId: ID, minutesBefore: 30 }],
      ownerTimezone: TZ,
      until: at("2026-11-16T12:31:00Z"),
      now: at("2026-11-16T12:31:00Z"),
    }
    const [first] = dueReminders({ ...input, delivered: new Set() })
    expect(dueReminders({ ...input, delivered: new Set(first!.keys) })).toEqual([])
  })

  it("collapses reminders of one occurrence that are due together", () => {
    const due = dueReminders({
      events: [event()],
      reminders: [
        { eventId: ID, minutesBefore: 60 },
        { eventId: ID, minutesBefore: 15 },
        { eventId: ID, minutesBefore: 1440 },
      ],
      delivered: new Set(),
      ownerTimezone: TZ,
      until: at("2026-11-16T12:50:00Z"),
      now: at("2026-11-16T12:50:00Z"),
    })
    expect(due).toHaveLength(1)
    expect(due[0]!.minutesBefore).toBe(15)
    expect(due[0]!.keys).toHaveLength(2) // 1440 minutes before fell outside the 6 h lookback
  })

  it("expands recurring events and keys each occurrence separately", () => {
    const weekly = event({ rrule: "FREQ=WEEKLY", startAt: at("2026-11-09T13:00:00Z"), endAt: at("2026-11-09T14:00:00Z") })
    const due = dueReminders({
      events: [weekly],
      reminders: [{ eventId: ID, minutesBefore: 30 }],
      delivered: new Set([deliveryKey(ID, at("2026-11-09T13:00:00Z"), 30)]),
      ownerTimezone: TZ,
      until: at("2026-11-16T12:30:00Z"),
      now: at("2026-11-16T12:30:00Z"),
    })
    expect(due.map((d) => d.keys[0])).toEqual([deliveryKey(ID, at("2026-11-16T13:00:00Z"), 30)])
  })

  it("keeps wall-clock time across DST for recurring events", () => {
    // Weekly 09:00 Prague from October (UTC+2) into November (UTC+1).
    const weekly = event({ rrule: "FREQ=WEEKLY", startAt: at("2026-10-19T07:00:00Z"), endAt: at("2026-10-19T08:00:00Z") })
    const due = dueReminders({
      events: [weekly],
      reminders: [{ eventId: ID, minutesBefore: 10 }],
      delivered: new Set(),
      ownerTimezone: TZ,
      until: at("2026-11-16T07:50:00Z"),
      now: at("2026-11-16T07:50:00Z"),
    })
    expect(due).toHaveLength(1)
    expect(due[0]!.when).toBe("09:00")
  })

  it("names the day when the reminder fires on an earlier day", () => {
    const due = dueReminders({
      events: [event()],
      reminders: [{ eventId: ID, minutesBefore: 1440 }],
      delivered: new Set(),
      ownerTimezone: TZ,
      until: at("2026-11-15T13:00:00Z"),
      now: at("2026-11-15T13:00:00Z"),
    })
    expect(due[0]!.when).toBe("Mon 16 Nov · 14:00")
  })

  it("anchors all-day reminders at local midnight", () => {
    const allDay = event({ id: ID2, title: "Mum's birthday", allDay: true, startAt: at("2026-11-17T00:00:00Z"), endAt: at("2026-11-18T00:00:00Z") })
    const input = { events: [allDay], reminders: [{ eventId: ID2, minutesBefore: 0 }], delivered: new Set<string>(), ownerTimezone: TZ }
    // Local midnight of 17 Nov in Prague is 23:00 UTC on the 16th.
    expect(dueReminders({ ...input, until: at("2026-11-16T22:59:00Z"), now: at("2026-11-16T22:59:00Z") })).toEqual([])
    const [due] = dueReminders({ ...input, until: at("2026-11-16T23:00:00Z"), now: at("2026-11-16T23:00:00Z") })
    expect(due).toMatchObject({ start: "2026-11-16T23:00:00.000Z", when: "Tue 17 Nov", allDay: true })
    expect(due!.keys).toEqual([deliveryKey(ID2, at("2026-11-17T00:00:00Z"), 0)])
  })

  it("skips reminders older than the lookback and occurrences that are over", () => {
    const base = { events: [event()], reminders: [{ eventId: ID, minutesBefore: 30 }], delivered: new Set<string>(), ownerTimezone: TZ }
    // Due 12:30, the bot comes back at 14:30: the dentist is over.
    expect(dueReminders({ ...base, until: at("2026-11-16T14:30:00Z"), now: at("2026-11-16T14:30:00Z") })).toEqual([])
    // Still on (13:30): late, but useful.
    expect(dueReminders({ ...base, until: at("2026-11-16T13:30:00Z"), now: at("2026-11-16T13:30:00Z") })).toHaveLength(1)
    // A short lookback drops it.
    expect(
      dueReminders({ ...base, until: at("2026-11-16T13:30:00Z"), now: at("2026-11-16T13:30:00Z"), lookbackMinutes: 30 }),
    ).toEqual([])
  })

  it("ignores events without reminders", () => {
    expect(
      dueReminders({ events: [event()], reminders: [], delivered: new Set(), ownerTimezone: TZ, until: at("2026-11-16T12:30:00Z"), now: at("2026-11-16T12:30:00Z") }),
    ).toEqual([])
  })
})

describe("delivery keys", () => {
  it("round-trip", () => {
    const key = deliveryKey(ID, at("2026-11-16T13:00:00Z"), 30)
    expect(key).toBe(`${ID}:2026-11-16T13:00:00.000Z:30`)
    expect(parseDeliveryKey(key)).toEqual({ eventId: ID, occurrenceStart: at("2026-11-16T13:00:00Z"), minutesBefore: 30 })
  })

  it("reject anything else", () => {
    for (const bad of ["", "x:y:z", `${ID}:2026-11-16:30`, `${ID}:2026-11-16T13:00:00.000Z:99999`, `${ID}:2026-11-16T13:00:00.000Z:-1`]) {
      expect(parseDeliveryKey(bad)).toBeNull()
    }
  })
})
