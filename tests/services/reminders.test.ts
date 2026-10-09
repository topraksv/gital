/**
 * The phone's reminder service (SPEC 12.1, 12.3) over a stubbed
 * `expo-notifications`: it asks permission only when switched on, schedules
 * only while on and allowed, and replaces the whole plan, never erasing
 * yesterday's reminders on a failed read.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const taps = vi.hoisted(() => ({ last: null as unknown, cleared: 0, listener: null as ((response: unknown) => void) | null, removed: 0 }));
const phone = vi.hoisted(() => ({ granted: true, stored: new Map<string, string>(), readFails: false, wishes: [] as { name: string; dueOn: string; boughtAt: null }[] }));

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
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  getLastNotificationResponse: () => taps.last,
  clearLastNotificationResponse: () => {
    taps.cleared++;
    taps.last = null;
  },
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    taps.listener = listener;
    return { remove: () => void taps.removed++ };
  },
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
vi.mock("../../src/data/settings", () => ({ readSettings: async () => [], restockAsideOf: () => new Map() }));
vi.mock("../../src/data/wishes", () => ({ readDueWishes: async () => phone.wishes }));

const { cancelReminders, disableReminders, enableReminders, followReminderTaps, replanReminders } = await import("../../src/services/reminders.native");
const { saveShoppingDay } = await import("../../src/services/reminder-preferences");
const { addDaysISO, todayISO } = await import("../../src/domain/dates");

beforeEach(() => {
  calls.length = 0;
  phone.granted = true;
  phone.readFails = false;
  phone.wishes = [];
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

  it("say a wish's date as a pantry date is said", async () => {
    phone.wishes = [{ name: "Kahve makinesi", dueOn: addDaysISO(todayISO(), 3), boughtAt: null }];
    await enableReminders();
    expect(calls).toContain("date: İstek tarihi — Kahve makinesi için yarın son gün.");
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

  it("clear everything at a sign-out, and keep the switch for the next account", async () => {
    await saveShoppingDay({ weekday: 6, hour: 10, minute: 0 });
    await enableReminders();
    calls.length = 0;
    await cancelReminders();
    expect(calls).toEqual(["cancel"]);
    calls.length = 0;
    await replanReminders();
    expect(calls[0]).toBe("cancel");
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe("a tap on a reminder", () => {
  const tap = (identifier: string, route: unknown, actionIdentifier = "expo.modules.notifications.actions.DEFAULT") => ({
    actionIdentifier,
    notification: { request: { identifier, content: { data: { route } } } },
  });

  it("opens what the reminder is about, the launch tap once, and stops listening when asked", () => {
    taps.last = tap("launch", { pathname: "/pantry" });
    taps.cleared = 0;
    taps.removed = 0;
    const opened: unknown[] = [];
    const stop = followReminderTaps((route) => opened.push(route));
    expect(opened).toEqual([{ pathname: "/pantry" }]);
    expect(taps.cleared, "a handled launch tap is not replayed").toBe(1);

    taps.listener!(tap("launch", { pathname: "/pantry" }));
    taps.listener!(tap("later", { pathname: "/list/[id]", params: { id: "l" } }));
    taps.listener!(tap("dismissed", { pathname: "/wishes" }, "expo.modules.notifications.actions.DISMISS"));
    taps.listener!(tap("unknown", { pathname: "/nowhere" }));
    expect(opened).toEqual([{ pathname: "/pantry" }, { pathname: "/list/[id]", params: { id: "l" } }]);

    stop();
    expect(taps.removed).toBe(1);
  });

  it("listens even with no launch tap to read", () => {
    taps.last = null;
    const opened: unknown[] = [];
    followReminderTaps((route) => opened.push(route));
    taps.listener!(tap("first", { pathname: "/" }));
    expect(opened).toEqual([{ pathname: "/" }]);
  });
});
