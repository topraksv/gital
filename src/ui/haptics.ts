/**
 * Haptic feedback, iOS only; Android and web are no-ops. Helix's wrapper,
 * ported with the feels Gital calls today: `selectionTap` for moving between
 * discrete choices — tabs, tiles — which is Apple's pattern for selection;
 * `mediumImpact` for a delete (`docs/UI.md` section 7); `errorNotice` for a
 * failure a dialog reports.
 */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** An enhancement: unsupported hardware must never turn a tap into an unhandled rejection. */
function feel(play: () => Promise<void>): void {
  if (Platform.OS !== "ios") return;
  void Promise.resolve().then(play).catch(() => {});
}

export function selectionTap(): void {
  feel(() => Haptics.selectionAsync());
}

export function selectionTapIfChanged(previous: string | null | undefined, next: string): void {
  if (previous !== next) selectionTap();
}

export function mediumImpact(): void {
  feel(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export function errorNotice(): void {
  feel(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
