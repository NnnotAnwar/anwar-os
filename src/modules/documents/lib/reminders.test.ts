import { describe, expect, it } from "vitest"
import { addDaysIso, ownerClock } from "./dates"
import {
  candidateKeys,
  currentStage,
  dueReminder,
  dueReminders,
  normalizeReminderDays,
  reached,
  REMINDER_KEY,
  reminderStages,
  snoozeKey,
  stageKey,
  type ScheduledDocument,
} from "./reminders"

const ID = "11111111-1111-4111-8111-111111111111"
const ID2 = "22222222-2222-4222-8222-222222222222"
const EXPIRES = "2026-12-24"

function doc(over: Partial<ScheduledDocument> = {}): ScheduledDocument {
  return { id: ID, expiresOn: EXPIRES, reminderDays: [90, 30, 7, 0], remindersFrom: "2026-01-01", snoozedUntil: null, ...over }
}

const at = (today: string, time = "10:00") => ({ today, time })
const before = (days: number) => addDaysIso(EXPIRES, -days)
const none = new Set<string>()

describe("reminderStages", () => {
  it("puts a stage on each offset day and one the day after expiry, earliest first", () => {
    expect(reminderStages(EXPIRES, [0, 30, 90, 7])).toEqual([
      { stage: "90", day: "2026-09-25" },
      { stage: "30", day: "2026-11-24" },
      { stage: "7", day: "2026-12-17" },
      { stage: "0", day: "2026-12-24" },
      { stage: "expired", day: "2026-12-25" },
    ])
  })

  it("has no stages at all when reminders are off", () => {
    expect(reminderStages(EXPIRES, [])).toEqual([])
    expect(dueReminder(doc({ reminderDays: [] }), at("2026-12-25"), none)).toBeNull()
  })

  it("dedupes and sorts offsets largest first", () => {
    expect(normalizeReminderDays([7, 90, 7, 0, 30])).toEqual([90, 30, 7, 0])
  })

  it("crosses month and year ends", () => {
    expect(reminderStages("2027-01-05", [7]).map((s) => s.day)).toEqual(["2026-12-29", "2027-01-06"])
    expect(reminderStages("2028-03-01", [1]).map((s) => s.day)).toEqual(["2028-02-29", "2028-03-02"])
  })
})

describe("reached", () => {
  it("opens a day at 10:00 in the owner's clock", () => {
    expect(reached("2026-11-24", at("2026-11-24", "09:59"))).toBe(false)
    expect(reached("2026-11-24", at("2026-11-24", "10:00"))).toBe(true)
    expect(reached("2026-11-24", at("2026-11-25", "00:01"))).toBe(true)
    expect(reached("2026-11-25", at("2026-11-24", "23:59"))).toBe(false)
  })
})

describe("dueReminder", () => {
  it("sends each stage at 10:00 on its day, once", () => {
    const sent90 = new Set([stageKey(ID, EXPIRES, "90")])
    expect(dueReminder(doc(), at(before(30), "09:59"), sent90)).toBeNull()
    const due = dueReminder(doc(), at(before(30)), sent90)
    expect(due).toEqual({ id: ID, stage: "30", dueOn: before(30), late: false, snoozed: false, keys: [stageKey(ID, EXPIRES, "30")] })
    expect(dueReminder(doc(), at(before(30), "18:00"), new Set([...sent90, ...due!.keys]))).toBeNull()
  })

  it("sends nothing between stages once the last one went out", () => {
    const sent = new Set([stageKey(ID, EXPIRES, "30")])
    expect(dueReminder(doc(), at(before(20)), sent)).toBeNull()
  })

  it("sends a missed stage late, once", () => {
    // The bot was down on the 30-day mark and comes back four days later at 08:00.
    const due = dueReminder(doc(), at(before(26), "08:00"), none)
    expect(due).toMatchObject({ stage: "30", dueOn: before(30), late: true, keys: [stageKey(ID, EXPIRES, "30")] })
    expect(dueReminder(doc(), at(before(26), "08:01"), new Set(due!.keys))).toBeNull()
  })

  it("never sends a 90-day card once the 30-day one is due", () => {
    // Down from before the 90-day mark until after the 30-day mark: only the 30-day card goes out.
    const due = dueReminder(doc(), at(before(29)), none)
    expect(due?.stage).toBe("30")
    expect(due?.keys).toEqual([stageKey(ID, EXPIRES, "30")])
    // And with the 30-day one sent, the stale 90-day one stays unsent.
    expect(dueReminder(doc(), at(before(28)), new Set(due!.keys))).toBeNull()
  })

  it("sends the day itself and a final card the day after expiry", () => {
    expect(dueReminder(doc(), at(EXPIRES), new Set([stageKey(ID, EXPIRES, "7")]))?.stage).toBe("0")
    const expired = dueReminder(doc(), at("2026-12-25"), new Set([stageKey(ID, EXPIRES, "0")]))
    expect(expired).toMatchObject({ stage: "expired", late: false, keys: [stageKey(ID, EXPIRES, "expired")] })
    expect(dueReminder(doc(), at("2027-01-10"), new Set(expired!.keys))).toBeNull()
  })

  it("sends a missed expired card late, but not more than 30 days late", () => {
    expect(dueReminder(doc(), at("2027-01-20"), none)).toMatchObject({ stage: "expired", late: true })
    expect(dueReminder(doc(), at("2027-01-24"), none)?.stage).toBe("expired")
    expect(dueReminder(doc(), at("2027-01-25"), none)).toBeNull()
    expect(dueReminder(doc(), at("2029-06-01"), none)).toBeNull()
  })

  it("skips stages before the expiry date or offsets were set (a renewal or a new document)", () => {
    // Added 20 days before expiry: the 90- and 30-day marks are history, the 7-day one comes.
    const fresh = doc({ remindersFrom: before(20) })
    expect(dueReminder(fresh, at(before(20), "12:00"), none)).toBeNull()
    expect(dueReminder(fresh, at(before(7)), none)?.stage).toBe("7")
    // A stage on the very day it was set still counts (it's that stage's day).
    expect(dueReminder(doc({ remindersFrom: before(30) }), at(before(30), "15:00"), none)?.stage).toBe("30")
    // An old, already expired passport added today gets no "expired" card.
    expect(dueReminder(doc({ remindersFrom: "2027-01-02" }), at("2027-01-02"), none)).toBeNull()
  })

  it("starts over when the expiry date changes (keys carry the date)", () => {
    const renewed = doc({ expiresOn: "2031-12-24", remindersFrom: "2026-12-26" })
    const oldKeys = new Set(candidateKeys(doc()))
    expect(dueReminder(renewed, at("2026-12-26"), oldKeys)).toBeNull()
    expect(dueReminder(renewed, at("2031-09-25"), oldKeys)?.keys).toEqual([stageKey(ID, "2031-12-24", "90")])
  })

  it("sends a snoozed card on the snooze day, once", () => {
    const sent = new Set([stageKey(ID, EXPIRES, "30")])
    const snoozed = doc({ snoozedUntil: before(29) })
    expect(dueReminder(snoozed, at(before(29), "09:00"), sent)).toBeNull()
    const due = dueReminder(snoozed, at(before(29)), sent)
    expect(due).toEqual({ id: ID, stage: "snooze", dueOn: before(29), late: false, snoozed: true, keys: [snoozeKey(ID, EXPIRES, before(29))] })
    expect(dueReminder(snoozed, at(before(29), "11:00"), new Set([...sent, ...due!.keys]))).toBeNull()
  })

  it("folds a snooze that lands on a stage day into that stage's card", () => {
    const sent = new Set([stageKey(ID, EXPIRES, "7")])
    const due = dueReminder(doc({ snoozedUntil: EXPIRES }), at(EXPIRES), sent)
    expect(due?.stage).toBe("0")
    expect(due?.snoozed).toBe(true)
    expect(due?.keys).toEqual([stageKey(ID, EXPIRES, "0"), snoozeKey(ID, EXPIRES, EXPIRES)])
  })

  it("makes keys the ack endpoint accepts", () => {
    for (const key of candidateKeys(doc({ snoozedUntil: "2026-12-01" }))) expect(REMINDER_KEY.test(key)).toBe(true)
    expect(REMINDER_KEY.exec(stageKey(ID, EXPIRES, "730"))?.[1]).toBe(ID)
    expect(REMINDER_KEY.test(`${ID}:${EXPIRES}:1000`)).toBe(false)
    expect(REMINDER_KEY.test(`${ID}:${EXPIRES}:soon`)).toBe(false)
  })
})

describe("dueReminders", () => {
  it("returns one card per due document, soonest expiry first", () => {
    const later = doc({ id: ID2, expiresOn: "2027-01-01" })
    const today = at("2026-12-17")
    const due = dueReminders([later, doc()], today, none)
    expect(due.map((d) => [d.id, d.stage])).toEqual([
      [ID, "7"],
      [ID2, "30"],
    ])
  })
})

describe("owner clock and DST", () => {
  const PRAGUE = "Europe/Prague"

  it("uses the owner's day and time, not UTC's", () => {
    // 09:30 UTC in winter is 10:30 in Prague; 23:30 UTC on the 24th is already the 25th there.
    expect(ownerClock(PRAGUE, new Date("2026-11-24T09:30:00Z"))).toEqual({ today: "2026-11-24", time: "10:30" })
    expect(ownerClock(PRAGUE, new Date("2026-12-24T23:30:00Z"))).toEqual({ today: "2026-12-25", time: "00:30" })
  })

  it("keeps 10:00 local across the spring and autumn clock changes", () => {
    const d = doc({ expiresOn: "2026-04-05", reminderDays: [7] }) // the 7-day stage is 29 Mar, the day clocks go forward
    expect(reminderStages(d.expiresOn, d.reminderDays)[0]!.day).toBe("2026-03-29")
    // 07:59 UTC = 09:59 CEST (UTC+2 from 02:00 that day): not yet; 08:00 UTC = 10:00: due.
    expect(currentStage(d, ownerClock(PRAGUE, new Date("2026-03-29T07:59:00Z")))).toBeNull()
    expect(currentStage(d, ownerClock(PRAGUE, new Date("2026-03-29T08:00:00Z")))?.stage).toBe("7")

    const autumn = doc({ expiresOn: "2026-11-01", reminderDays: [7] }) // 25 Oct, clocks go back at 03:00
    expect(currentStage(autumn, ownerClock(PRAGUE, new Date("2026-10-25T08:59:00Z")))).toBeNull() // 09:59 CET
    expect(currentStage(autumn, ownerClock(PRAGUE, new Date("2026-10-25T09:00:00Z")))?.stage).toBe("7") // 10:00 CET
  })

  it("counts whole days across a DST change", () => {
    expect(addDaysIso("2026-03-28", 1)).toBe("2026-03-29")
    expect(addDaysIso("2026-10-24", 2)).toBe("2026-10-26")
  })
})
