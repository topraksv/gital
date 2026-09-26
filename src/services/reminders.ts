/**
 * The web has no reminders: `expo-notifications` schedules on Android and iOS
 * only (SPEC 12.1). `reminders.native.ts` is the phone's; this file is what
 * the web bundles in its place, so the package never reaches the web entry.
 */

export const remindersAvailable = false;

export async function enableReminders(): Promise<boolean> {
  return false;
}

export async function disableReminders(): Promise<void> {}

export async function replanReminders(): Promise<void> {}
