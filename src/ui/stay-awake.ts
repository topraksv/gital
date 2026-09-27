/**
 * Keeping the screen on while a list is being shopped (`docs/SPEC.md` 3.3).
 * expo-keep-awake's own hook was not enough on the web, for two reasons.
 * The browser lets the wake lock go whenever the page is hidden — a glance
 * at a message in the aisle — and never takes it back; and a lock the
 * browser refused throws on its release.
 */

import { useEffect, useSyncExternalStore } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { kv } from "../services/kv";

const TAG = "gital.shopping";

/** Holds the screen on until the returned function lets it go. */
export function stayAwake(): () => void {
  const hold = () => void activateKeepAwakeAsync(TAG).catch(() => {});
  // Only the web has a document; a phone's lock survives the app's own background.
  const page = typeof document === "undefined" ? null : document;
  const back = () => {
    if (page?.visibilityState === "visible") hold();
  };
  hold();
  page?.addEventListener("visibilitychange", back);
  return () => {
    page?.removeEventListener("visibilitychange", back);
    void deactivateKeepAwake(TAG).catch(() => {});
  };
}

/**
 * Whether a shop keeps the screen on at all, Ayarlar's switch (the owner asked
 * 2026-09-27). On by default, as 3.3 shipped; kept on this device, since
 * whether a screen may sleep is the phone's business, not the account's.
 */
const PREFERENCE_KEY = "gital.stayAwake";
let allowed = true;
const listeners = new Set<() => void>();
void kv.get(PREFERENCE_KEY).then((stored) => {
  if (stored !== "false") return;
  allowed = false;
  listeners.forEach((listener) => listener());
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStayAwakeAllowed(): boolean {
  return useSyncExternalStore(subscribe, () => allowed, () => allowed);
}

export function setStayAwakeAllowed(on: boolean): void {
  allowed = on;
  listeners.forEach((listener) => listener());
  void kv.set(PREFERENCE_KEY, String(on));
}

/** Keeps the screen on for as long as `on` holds, and Ayarlar allows it. */
export function useStayAwake(on: boolean): void {
  const allowedHere = useStayAwakeAllowed();
  const hold = on && allowedHere;
  useEffect(() => (hold ? stayAwake() : undefined), [hold]);
}
