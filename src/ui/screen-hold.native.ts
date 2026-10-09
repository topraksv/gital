/**
 * The phone's screen hold, for `stay-awake.ts`. The web bundles
 * `screen-hold.ts` in its place, so `expo-keep-awake` never reaches the web
 * entry, which held it for nothing (about 3.5 KB, 2026-09-26).
 */

import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const TAG = "gital";

/** Holds the screen on until the returned function lets it go. Either can be refused, with no activity to hold. */
export function stayAwake(): () => void {
  void activateKeepAwakeAsync(TAG).catch(() => {});
  return () => void deactivateKeepAwake(TAG).catch(() => {});
}
