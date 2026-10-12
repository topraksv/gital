/** Keeps a phone's screen on wherever in Gital the person is (SPEC 3.3); not on the web, whose wake lock lapses whenever the page is hidden. */

import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { kvSwitch } from "../services/kv";
import { stayAwake } from "./screen-hold";

export const stayAwakeAvailable = Platform.OS !== "web";

/** Ayarlar's switch, kept on this device: whether a screen may sleep is the phone's business, not the account's. */
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
