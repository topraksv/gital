/**
 * A row that makes room and closes its own gap: Helix's `list-motion.native.tsx`.
 * `LinearTransition` animates the positions the layout pass computes anyway,
 * so a tick carries the row down to the basket and a delete shows which gap
 * closed, for the cost of a worklet rather than a re-render.
 *
 * `ReduceMotion.System` is not optional: a Reanimated animation does not ask
 * `useReducedMotion`, so without it this would be the one motion that ignores
 * the setting. The `.native` split keeps Reanimated and gesture-handler out of
 * the web bundle.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { SwipeSides } from "./components";
import { selectionTap } from "./haptics";
import type { RowAction, RowSwipeProps } from "./list-motion";
import { iconSize, iconStroke, itemRow, motion, radius, useTheme } from "./theme";

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

/**
 * A panel that changes size as a row inside it comes or goes: it slides to
 * its new height rather than jumping, and nothing inside fades in on the
 * first draw, only when it arrives later.
 */
export function PanelMotion({ children }: { children: ReactNode }) {
  return (
    <LayoutAnimationConfig skipEntering>
      <Animated.View layout={LinearTransition.duration(motion.standard).reduceMotion(ReduceMotion.System)}>{children}</Animated.View>
    </LayoutAnimationConfig>
  );
}

/** A part of a panel: one that `appears` fades in and out, and every part slides to make room. */
export function PanelPart({ children, appears = false }: { children: ReactNode; appears?: boolean }) {
  return (
    <Animated.View
      layout={LinearTransition.duration(motion.standard).reduceMotion(ReduceMotion.System)}
      entering={appears ? FadeIn.duration(motion.standard).reduceMotion(ReduceMotion.System) : undefined}
      exiting={appears ? FadeOut.duration(motion.feedback).reduceMotion(ReduceMotion.System) : undefined}
    >
      {children}
    </Animated.View>
  );
}

/** Gesture-handler reads touches only under this root; mounted once, above the router. */
export function GestureRoot({ children }: { children: ReactNode }) {
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>;
}

const home = { ...motion.spring.entrance, reduceMotion: ReduceMotion.System };

/** Which way a row released at `x` acts: past `itemRow.swipe` either way, or not at all. A side with no action never gets there. */
function releaseSide(x: number): 1 | -1 | 0 {
  "worklet";
  return x >= itemRow.swipe ? 1 : x <= -itemRow.swipe ? -1 : 0;
}

/**
 * A row that swipes (`docs/UI.md` section 8): each side runs the action it is
 * given, or travels not at all. The row follows the thumb over
 * its action; past `itemRow.swipe` the icon lifts with a touch, and on release
 * the row springs home and acts if, and only if, it was past — one rule for
 * the feel and the outcome, so a flick that never lifted the icon never acts.
 */
export function RowSwipe({ children, right, left }: RowSwipeProps) {
  const canRight = right != null;
  const canLeft = left != null;
  const x = useSharedValue(0);
  const origin = useSharedValue(0);
  // Where the last release acted. The gesture writes only shared values and
  // the actions are read from a ref, so neither the gesture nor the reaction
  // changes when a list re-render hands every row new closures; were they to,
  // each render would rebuild every row's gesture and send it to the native side.
  const released = useSharedValue<1 | -1 | 0>(0);
  const sides = useRef({ right, left });
  useEffect(() => {
    sides.current = { right, left };
  });
  const run = useCallback((side: 1 | -1) => (side === 1 ? sides.current.right : sides.current.left)?.run(), []);
  // The actions mount for a swipe and leave when the row is home: forty rows
  // at rest carry none of their icons.
  const [swiping, setSwiping] = useState(false);

  useAnimatedReaction(
    () => released.get(),
    (side) => {
      if (side === 0) return;
      released.set(0);
      scheduleOnRN(run, side);
    },
    [run],
  );
  useAnimatedReaction(
    () => releaseSide(x.get()) !== 0,
    (past, before) => {
      if (past && before === false) scheduleOnRN(selectionTap);
    },
    [],
  );

  const pan = useMemo(() => Gesture.Pan()
    // No action on either side: the row is a plain row, and the tree is the same.
    .enabled(canRight || canLeft)
    // Sideways first, or it is a scroll: a vertical drag that drifts is never a swipe.
    .activeOffsetX([-itemRow.slop, itemRow.slop])
    .failOffsetY([-itemRow.slop, itemRow.slop])
    .onStart(() => {
      origin.set(x.get());
      scheduleOnRN(setSwiping, true);
    })
    .onUpdate((event) => {
      const next = origin.get() + event.translationX;
      // A side with no action does not travel.
      x.set(next > 0 ? (canRight ? next : 0) : canLeft ? next : 0);
    })
    .onEnd((_event, success) => {
      if (success) released.set(releaseSide(x.get()));
      x.set(
        withSpring(0, home, (finished) => {
          if (finished) scheduleOnRN(setSwiping, false);
        }),
      );
    }), [canRight, canLeft, x, origin, released]);

  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View style={{ borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden" }}>
      {swiping ? <SwipeActions x={x} right={right} left={left} /> : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={follow}>
          <SwipeSides.Provider value={{ right, left }}>{children}</SwipeSides.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function SwipeActions({ x, right, left }: { x: SharedValue<number>; right?: RowAction; left?: RowAction }) {
  // Held from the swipe's start: the action lands while the row springs home,
  // and the icon under it must not turn into its own undo.
  const [held] = useState({ right, left });
  return (
    <>
      {held.right ? <SwipeAction x={x} side={1} action={held.right} /> : null}
      {held.left ? <SwipeAction x={x} side={-1} action={held.left} /> : null}
    </>
  );
}

function SwipeAction({
  x,
  side,
  action,
}: {
  x: SharedValue<number>;
  /** 1 for the action a rightward swipe uncovers, -1 for the leftward one. */
  side: 1 | -1;
  action: RowAction;
}) {
  const { palette } = useTheme();
  const Icon = action.icon;
  const fill = palette[action.tone];
  const ink = palette[ON[action.tone]];
  const shown = useAnimatedStyle(() => ({ opacity: x.get() * side > 0 ? 1 : 0 }));
  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(releaseSide(x.get()) === side ? 1.25 : 1, home) }],
  }));
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: fill, flexDirection: side === 1 ? "row" : "row-reverse", alignItems: "center" },
        shown,
      ]}
    >
      <Animated.View style={[{ width: itemRow.swipe, alignItems: "center" }, lift]}>
        <Icon accessible={false} size={iconSize.control} color={ink} strokeWidth={iconStroke.mark} />
      </Animated.View>
    </Animated.View>
  );
}

const ON = { secondary: "onSecondary", primary: "onPrimary", destructive: "onDestructive" } as const;
