import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, type EmitterSubscription } from "react-native";
import { motion } from "./theme";

let reducedMotion = false;
let nativeSubscription: EmitterSubscription | null = null;
const listeners = new Set<() => void>();

function updateReducedMotion(next: boolean) {
  if (reducedMotion === next) return;
  reducedMotion = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void AccessibilityInfo.isReduceMotionEnabled().then(updateReducedMotion).catch(() => {});
    nativeSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", updateReducedMotion);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      nativeSubscription?.remove();
      nativeSubscription = null;
    }
  };
}

/** One shared native listener backs every animated primitive in the app. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reducedMotion, () => false);
}

/**
 * The same answer without subscribing, for a style a Pressable already
 * re-renders to produce: a hook there adds a subscriber per control on screen.
 */
export function isReducedMotion(): boolean {
  return reducedMotion;
}

/**
 * The spring every moving part shares, so a gesture's settle and a mount's
 * arrival feel alike. `native: false` is for geometry the native driver cannot
 * move, such as an SVG dash.
 */
export function springTo(value: Animated.Value, toValue: number, native = true): Animated.CompositeAnimation {
  return Animated.spring(value, { toValue, useNativeDriver: native && Platform.OS !== "web", ...motion.spring.entrance });
}

/** Springs `value` to `target` whenever the target moves; under reduced motion it jumps there. */
export function useSpringTo(value: Animated.Value, target: number, native = true): void {
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) {
      value.setValue(target);
      return;
    }
    const animation = springTo(value, target, native);
    animation.start();
    return () => animation.stop();
  }, [value, target, reducedMotion, native]);
}

let reduceTransparency = false;
let transparencySubscription: EmitterSubscription | null = null;
const transparencyListeners = new Set<() => void>();

function updateReduceTransparency(next: boolean) {
  if (reduceTransparency === next) return;
  reduceTransparency = next;
  for (const listener of transparencyListeners) listener();
}

function subscribeTransparency(listener: () => void) {
  transparencyListeners.add(listener);
  // react-native-web ships no transparency query, and calling it unguarded
  // throws at first render. The setting is iOS-only; absent means false.
  if (transparencyListeners.size === 1 && typeof AccessibilityInfo.isReduceTransparencyEnabled === "function") {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(updateReduceTransparency).catch(() => {});
    transparencySubscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", updateReduceTransparency);
  }
  return () => {
    transparencyListeners.delete(listener);
    if (transparencyListeners.size === 0) {
      transparencySubscription?.remove();
      transparencySubscription = null;
    }
  };
}

/** iOS "Reduce Transparency". Android and web blur nothing unasked, so false is correct there. */
export function useReduceTransparency(): boolean {
  return useSyncExternalStore(subscribeTransparency, () => reduceTransparency, () => false);
}

/**
 * A figure that counts to its value from the one last shown, never from zero
 * (`docs/UI.md` section 7): it arrives at its value, and a change counts
 * across the change. `from` is where a figure that arrives as an event, the
 * celebration's total, starts instead. Helix's `useCountUp`, without the
 * screen-visit replay the owner's rule forbids.
 */
export function useCountUp(value: number, from?: number): number {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(from ?? value);
  const last = useRef(from ?? value);
  useEffect(() => {
    const start = last.current;
    last.current = value;
    if (reducedMotion || start === value) {
      setShown(value);
      return;
    }
    const driver = new Animated.Value(0);
    driver.addListener(({ value: fraction }) => setShown(Math.round(start + (value - start) * fraction)));
    const animation = Animated.timing(driver, { toValue: 1, duration: motion.figure, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start(({ finished }) => finished && setShown(value));
    return () => {
      animation.stop();
      driver.removeAllListeners();
      setShown(value);
    };
  }, [value, reducedMotion]);
  return reducedMotion ? value : shown;
}

/**
 * 1 the moment `key` changes, fading to 0: a row an entry merged into says
 * which one it was. The first value is not a change. Helix's `useValueFlash`,
 * keyed on anything comparable rather than a number.
 */
export function useValueFlash(key: string): Animated.Value {
  const reducedMotion = useReducedMotion();
  const [flash] = useState(() => new Animated.Value(0));
  const previous = useRef(key);
  useEffect(() => {
    const changed = previous.current !== key;
    previous.current = key;
    if (!changed || reducedMotion) return;
    flash.setValue(1);
    const animation = Animated.timing(flash, { toValue: 0, duration: motion.settle, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" });
    animation.start();
    return () => animation.stop();
  }, [key, flash, reducedMotion]);
  return flash;
}
