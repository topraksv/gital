/**
 * The phone's reminder service (SPEC 12.1, 12.3) over a stubbed
 * `expo-notifications`: it asks permission only when switched on, schedules
 * only while on and allowed, and replaces the whole plan, never erasing
 * yesterday's reminders on a failed read.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const phone = vi.hoisted(() => ({ granted: true, stored: new Map<string, string>(), readFails: false }));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: {},
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted: phone.granted }),
  requestPermissionsAsync: async () => {
    calls.push("ask");
    return { granted: phone.granted };
  },
  cancelAllScheduledNotificationsAsync: async () => void calls.push("cancel"),
  scheduleNotificationAsync: async (request: { content: { title: string; body: string }; trigger: { type: string } }) =>
    void calls.push(`${request.trigger.type}: ${request.content.title} — ${request.content.body}`),
}));
vi.mock("../../src/services/kv", () => ({
  kv: { get: async (key: string) => phone.stored.get(key) ?? null, set: async (key: string, value: string) => void phone.stored.set(key, value) },
}));
vi.mock("../../src/data/lists", () => ({
  readLists: async () => {
    if (phone.readFails) throw new Error("SQLITE_BUSY");
    return [{ id: "l", name: "Market", total: 3, inBasket: 1 }];
  },
}));
vi.mock("../../src/data/pantry", () => ({ readPantry: async () => [], readLasted: async () => [] }));
vi.mock("../../src/data/shops", () => ({ readPurchases: async () => [] }));
vi.mock("../../src/data/items", () => ({ readItems: async () => [] }));

const { disableReminders, enableReminders, replanReminders } = await import("../../src/services/reminders.native");
const { saveShoppingDay } = await import("../../src/services/reminder-preferences");

beforeEach(() => {
  calls.length = 0;
  phone.granted = true;
  phone.readFails = false;
  phone.stored.clear();
});

describe("reminders on the phone", () => {
  it("schedule nothing, and clear what was, while switched off", async () => {
    await saveShoppingDay({ weekday: 6, hour: 10, minute: 0 });
    await replanReminders();
    expect(calls).toEqual(["cancel"]);
  });

  it("ask once switched on, then schedule the plan in words", async () => {
    await saveShoppingDay({ weekday: 6, hour: 10, minute: 0 });
    phone.granted = false;
    expect(await enableReminders()).toBe(false);
    expect(calls).toEqual(["ask", "cancel"]);
    calls.length = 0;
    phone.granted = true;
    expect(await enableReminders()).toBe(true);
    expect(calls[0]).toBe("cancel");
    expect(calls[1]).toBe("date: Bugün alışveriş günü — Market: 2 ürün");
    expect(calls.slice(2).every((call) => call === "date: Bugün alışveriş günü — Listelerine bir göz at.")).toBe(true);
  });

  it("keep yesterday's reminders when the plan cannot be read", async () => {
    await enableReminders();
    calls.length = 0;
    phone.readFails = true;
    await expect(replanReminders()).rejects.toThrow("SQLITE_BUSY");
    expect(calls).toEqual([]);
    phone.readFails = false;
    await replanReminders();
    expect(calls[0]).toBe("cancel");
  });

  it("clear everything when switched off", async () => {
    await enableReminders();
    calls.length = 0;
    await disableReminders();
    expect(calls).toEqual(["cancel"]);
    await replanReminders();
    expect(calls).toEqual(["cancel", "cancel"]);
  });
});
