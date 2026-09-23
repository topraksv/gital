/**
 * Haptic feedback, iOS only; Android and web are no-ops. Helix's wrapper,
 * ported with the feels Gital calls today: `selectionTap` for moving between
 * discrete choices — tabs, tiles — which is Apple's pattern for selection.
 */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** An enhancement: unsupported hardware must never turn a tap into an unhandled rejection. */
export function selectionTap(): void {
  if (Platform.OS !== "ios") return;
  void Promise.resolve().then(() => Haptics.selectionAsync()).catch(() => {});
}

export function selectionTapIfChanged(previous: string | null | undefined, next: string): void {
  if (previous !== next) selectionTap();
}
