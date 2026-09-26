/**
 * Keeping the screen on while a list is being shopped (`docs/SPEC.md` 3.3).
 * expo-keep-awake's own hook was not enough on the web, for two reasons.
 * The browser lets the wake lock go whenever the page is hidden — a glance
 * at a message in the aisle — and never takes it back; and a lock the
 * browser refused throws on its release.
 */

import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

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

/** Keeps the screen on for as long as `on` holds. */
export function useStayAwake(on: boolean): void {
  useEffect(() => (on ? stayAwake() : undefined), [on]);
}
