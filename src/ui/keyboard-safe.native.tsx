/** Native half of Helix's keyboard contract; web deliberately resolves keyboard-safe.tsx. */

import type { ReactNode } from "react";
import { KeyboardAwareScrollView, KeyboardProvider } from "react-native-keyboard-controller";
import type { KeyboardSafeScrollViewProps } from "./keyboard-safe";

/**
 * The controller follows the keyboard frame and the focused input, rather
 * than every form keeping its own KeyboardAvoidingView inset — which Android's
 * edge-to-edge layout no longer resizes for.
 */
export function KeyboardSafeScrollView(props: KeyboardSafeScrollViewProps) {
  // The focused field stays where the person was reading after the keyboard
  // closes; snapping the whole form back down is disorienting.
  return <KeyboardAwareScrollView disableScrollOnKeyboardHide {...props} />;
}

/** Preloading can flash a keyboard on cold launch, so focus remains on demand. */
export function KeyboardSafeRoot({ children }: { children: ReactNode }) {
  return <KeyboardProvider preload={false}>{children}</KeyboardProvider>;
}
