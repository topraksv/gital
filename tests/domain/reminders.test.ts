/**
 * What the phone is told to say, and when (SPEC 12.1, 12.3): the shopping
 * day with what the lists hold, a pantry date drawing near, and a product
 * whose rhythm says it will have run out. Planned afresh each time the app
 * leaves the screen, so only what is ahead and within the horizon is planned.
 */

import { describe, expect, it } from "vitest";
import { REMINDER_HOUR, REMINDERS_MAX, planReminders, type ReminderInput } from "../../src/domain/reminders";

// Wednesday 2026-09-23, 20:00 local.
const now = new Date(2026, 8, 23, 20, 0);
const at = (day: number, hour = REMINDER_HOUR, minute = 0) => new Date(2026, 8, day, hour, minute);
const base: ReminderInput = { now, shoppingDay: null, lists: [], pantry: [], restock: [] };

describe("the shopping day", () => {
  it("comes each week within the horizon, the first saying what each list holds", () => {
    const planned = planReminders({ ...base, shoppingDay: { weekday: 6, hour: 10, minute: 30 }, lists: [{ name: "Market", open: 12 }, { name: "Eczane", open: 0 }] });
    expect(planned).toEqual([
      { kind: "shopping", at: at(26, 10, 30), lists: [{ name: "Market", open: 12 }] },
      { kind: "shopping", at: at(3 + 30, 10, 30), lists: null },
    ]);
  });

  it("is today when its hour is still ahead, next week when it has passed", () => {
    expect(planReminders({ ...base, shoppingDay: { weekday: 3, hour: 21, minute: 0 } })[0]!.at).toEqual(at(23, 21));
    expect(planReminders({ ...base, shoppingDay: { weekday: 3, hour: 19, minute: 0 } })[0]!.at).toEqual(at(30, 19));
  });
});

describe("a pantry date", () => {
  it("is said the morning before, or that morning when the one before has gone", () => {
    const planned = planReminders({ ...base, pantry: [{ name: "Yoğurt", expiresOn: "2026-09-26" }, { name: "Süt", expiresOn: "2026-09-24" }, { name: "Peynir", expiresOn: "2026-09-23" }, { name: "Un", expiresOn: null }] });
    expect(planned).toEqual([
      { kind: "expiry", at: at(24), name: "Süt", days: 0 },
      { kind: "expiry", at: at(25), name: "Yoğurt", days: 1 },
    ]);
  });
});

describe("a restock", () => {
  const weekly = (name: string, lastDay: number) => [0, 7, 14].map((back) => ({ name, quantityMilli: null, unit: null, boughtAt: new Date(2026, 8, lastDay - back, 12).toISOString() }));

  it("is said the first morning its rhythm says it has run out, once, and not for what is due already or on the list", () => {
    const planned = planReminders({
      ...base,
      restock: [{ listName: "Market", purchases: [...weekly("Süt", 20), ...weekly("Ekmek", 16)], onList: [], lasted: new Map() }, { listName: "Eczane", purchases: weekly("Vitamin", 20), onList: [{ name: "vitamin" }], lasted: new Map() }],
    });
    expect(planned).toEqual([{ kind: "restock", at: at(28), name: "Süt", listName: "Market" }]);
  });
});

it("keeps the soonest within what a phone holds, in order", () => {
  const pantry = Array.from({ length: REMINDERS_MAX + 5 }, (_, i) => ({ name: `Ürün ${i}`, expiresOn: `2026-09-${25 + (i % 5)}` }));
  const planned = planReminders({ ...base, pantry });
  expect(planned).toHaveLength(REMINDERS_MAX);
  expect(planned.map((each) => each.at.getTime())).toEqual([...planned.map((each) => each.at.getTime())].sort((a, b) => a - b));
});
