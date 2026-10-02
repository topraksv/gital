/**
 * Keeping the phone's screen on while Gital is open (`docs/SPEC.md` 3.3),
 * wherever in it the person is: the owner's phone went dark on every screen
 * but a list with something left to buy (2026-09-30). Only on a phone. A
 * browser lets its wake lock go each time the page is hidden, and a
 * computer's screen is not a shopping list held in one hand.
 */

import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { kvSwitch } from "../services/kv";

const TAG = "gital";

export const stayAwakeAvailable = Platform.OS !== "web";

/** Holds the screen on until the returned function lets it go. Either can be refused, with no activity to hold. */
export function stayAwake(): () => void {
  void activateKeepAwakeAsync(TAG).catch(() => {});
  return () => void deactivateKeepAwake(TAG).catch(() => {});
}

/**
 * Whether the screen is kept on at all, Ayarlar's switch (the owner asked
 * 2026-09-27). On by default, as 3.3 shipped; kept on this device, since
 * whether a screen may sleep is the phone's business, not the account's.
 */
const preference = kvSwitch("gital.stayAwake");

export function useStayAwakeAllowed(): boolean {
  return useSyncExternalStore(preference.subscribe, preference.get, preference.get);
}

export const setStayAwakeAllowed = preference.set;

/** Keeps the screen on while the app is open and Ayarlar allows it; the root layout holds it once. */
export function useStayAwake(): void {
  const hold = useStayAwakeAllowed() && stayAwakeAvailable;
  useEffect(() => (hold ? stayAwake() : undefined), [hold]);
}
