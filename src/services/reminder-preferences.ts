/**
 * Whether reminders are on and the shopping day (SPEC 12.1), kept on this
 * device: a reminder is this phone's, so a shared list's other member keeps
 * their own day. `docs/ARCHITECTURE.md` "Tables" names a synced `settings`
 * table for this; it lands with accounts, when there is a person to hold it.
 */

import type { ShoppingDay } from "../domain/reminders";
import { kv } from "./kv";

const KEYS = { on: "gital.reminders.on", day: "gital.reminders.day" } as const;

export interface ReminderPreferences {
  on: boolean;
  day: ShoppingDay | null;
}

function dayFrom(stored: string | null): ShoppingDay | null {
  try {
    const day = stored ? (JSON.parse(stored) as Partial<ShoppingDay>) : null;
    const whole = (value: unknown, max: number) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
    return day && whole(day.weekday, 6) && whole(day.hour, 23) && whole(day.minute, 59) ? (day as ShoppingDay) : null;
  } catch {
    return null;
  }
}

export async function readReminderPreferences(): Promise<ReminderPreferences> {
  const [on, day] = await Promise.all([kv.get(KEYS.on), kv.get(KEYS.day)]);
  return { on: on === "true", day: dayFrom(day) };
}

export function saveRemindersOn(on: boolean): Promise<void> {
  return kv.set(KEYS.on, String(on));
}

export function saveShoppingDay(day: ShoppingDay | null): Promise<void> {
  return kv.set(KEYS.day, day ? JSON.stringify(day) : "");
}
