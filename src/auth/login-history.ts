/** The sign-in before this one, kept on the device for the account screen (Helix's). */

import { uuidv7 } from "uuidv7";

export interface LoginHistoryStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function currentKey(userId: string): string {
  return `gital.login.current.${userId}`;
}

function previousKey(userId: string): string {
  return `gital.login.previous.${userId}`;
}

/**
 * Advance history only after a complete successful sign-in. The timestamp
 * returned is the login before the one being recorded, never this session.
 */
export async function recordSuccessfulLogin(
  storage: LoginHistoryStorage,
  userId: string,
  signedInAt: string,
): Promise<string | null> {
  const previous = await storage.get(currentKey(userId));
  if (previous) await storage.set(previousKey(userId), previous);
  else await storage.remove(previousKey(userId));
  await storage.set(currentKey(userId), signedInAt);
  return previous;
}

/** A fresh account starts a history but has no prior login to display. */
export async function startLoginHistory(
  storage: LoginHistoryStorage,
  userId: string,
  signedInAt: string,
): Promise<void> {
  await storage.remove(previousKey(userId));
  await storage.set(currentKey(userId), signedInAt);
}

/** Seed users who receive this feature mid-session without moving history. */
export async function seedCurrentLogin(
  storage: LoginHistoryStorage,
  userId: string,
  signedInAt: string,
): Promise<void> {
  if (await storage.get(currentKey(userId))) return;
  await storage.set(currentKey(userId), signedInAt);
}

/** Cold-starting an existing session does not advance login history. */
export function loadPreviousLogin(storage: LoginHistoryStorage, userId: string): Promise<string | null> {
  return storage.get(previousKey(userId));
}

const DEVICE_KEY = "gital.device.id";

/**
 * This install's own id, made once and kept across sign-outs: the key of the
 * one sign-in row each device writes to the account (`src/domain/logins.ts`).
 */
export async function deviceId(storage: LoginHistoryStorage): Promise<string> {
  const known = await storage.get(DEVICE_KEY);
  if (known) return known;
  const made = uuidv7();
  await storage.set(DEVICE_KEY, made);
  return made;
}
