/** The phone's screen hold; the web bundles `screen-hold.ts` instead, keeping `expo-keep-awake` out of its entry. */

import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const TAG = "gital";

/** Holds the screen on until the returned function lets it go. Either can be refused, with no activity to hold. */
export function stayAwake(): () => void {
  void activateKeepAwakeAsync(TAG).catch(() => {});
  return () => void deactivateKeepAwake(TAG).catch(() => {});
}
