/**
 * Local notifications on the phone (SPEC 12.1, 12.3), Helix's
 * `src/services/notifications.ts` for Gital's reminders: permission is asked
 * only from Ayarlar, and every plan cancels and replaces the last, so what is
 * scheduled is always `planReminders` of the present. One departure: the web
 * is kept out by `reminders.ts`, not by a Metro substitution, as Gital keeps
 * every other phone-only module.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { readItems } from "../data/items";
import { readLists } from "../data/lists";
import { readLasted, readPantry } from "../data/pantry";
import { readDueWishes } from "../data/wishes";
import { readPurchases } from "../data/shops";
import { planReminders, type Reminder } from "../domain/reminders";
import { tr } from "../i18n/tr";
import { readReminderPreferences, saveRemindersOn } from "./reminder-preferences";

export const remindersAvailable = true;

const CHANNEL = "gital-reminders";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

function granted(status: Notifications.NotificationPermissionsStatus): boolean {
  if (Platform.OS !== "ios") return status.granted;
  const ios = status.ios?.status;
  return (
    ios === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: tr.reminders.title, importance: Notifications.AndroidImportance.DEFAULT });
}

/** Asked only from Ayarlar's switch; `false` when the phone refused. */
export async function enableReminders(): Promise<boolean> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (!granted(granted(current) ? current : await Notifications.requestPermissionsAsync())) {
    await disableReminders();
    return false;
  }
  await saveRemindersOn(true);
  await replanReminders();
  return true;
}

export async function disableReminders(): Promise<void> {
  try {
    await saveRemindersOn(false);
  } finally {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }
}

function wordsOf(reminder: Reminder): { title: string; body: string } {
  switch (reminder.kind) {
    case "shopping":
      return { title: tr.reminders.shoppingTitle, body: tr.reminders.shoppingBody(reminder.lists) };
    case "expiry":
      return { title: tr.reminders.expiryTitle, body: tr.reminders.expiryBody(reminder.name, reminder.days) };
    case "wish":
      return { title: tr.reminders.wishTitle, body: tr.reminders.expiryBody(reminder.name, reminder.days) };
    case "restock":
      return { title: tr.reminders.restockTitle(reminder.name), body: tr.reminders.restockBody(reminder.listName) };
  }
}

async function planned(): Promise<Reminder[]> {
  const { day } = await readReminderPreferences();
  const [lists, pantry, lasted, wishes] = await Promise.all([readLists(), readPantry(), readLasted(), readDueWishes()]);
  const restock = await Promise.all(
    lists.map(async (list) => ({ listName: list.name, purchases: await readPurchases(list.id), onList: await readItems(list.id), lasted: new Map(lasted) })),
  );
  return planReminders({
    now: new Date(),
    shoppingDay: day,
    lists: lists.map((list) => ({ name: list.name, open: list.total - list.inBasket })),
    pantry,
    wishes,
    restock,
  });
}

// Planning at start and at every trip to the background can overlap; each waits for the last.
let queue: Promise<void> = Promise.resolve();

/** Cancel and schedule again from what is on the device now; nothing while off or refused. */
export function replanReminders(): Promise<void> {
  queue = queue.catch(() => {}).then(replace);
  return queue;
}

async function replace(): Promise<void> {
  if (!(await readReminderPreferences()).on || !granted(await Notifications.getPermissionsAsync())) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return;
  }
  await ensureChannel();
  // Planned before anything is cancelled: a failed read keeps yesterday's reminders.
  const next = await planned();
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const reminder of next) {
    await Notifications.scheduleNotificationAsync({
      content: wordsOf(reminder),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, ...(Platform.OS === "android" ? { channelId: CHANNEL } : {}) },
    });
  }
}
