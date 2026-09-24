/**
 * A row that makes room and closes its own gap: Helix's `list-motion.native.tsx`.
 * `LinearTransition` animates the positions the layout pass computes anyway,
 * so a tick carries the row down to the basket and a delete shows which gap
 * closed, for the cost of a worklet rather than a re-render.
 *
 * `ReduceMotion.System` is not optional: a Reanimated animation does not ask
 * `useReducedMotion`, so without it this would be the one motion that ignores
 * the setting. The `.native` split keeps Reanimated out of the web bundle.
 */
import type { ReactNode } from "react";
import Animated, { FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";

import { motion } from "./theme";

export function RowMotion({ children }: { children: ReactNode }) {
  return (
    <Animated.View
      layout={LinearTransition.duration(motion.standard).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(motion.feedback).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}
