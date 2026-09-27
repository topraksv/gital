/**
 * Gital's mark, Helix's `BrandMark` with the motion the owner asked for
 * (2026-09-27, "alevli hareket eden market sepeti"): one drawing split in two
 * layers, so the flames flicker behind a cart that rattles on. The ink is a
 * mask tinted by the theme, so one picture serves light and dark. Decoration:
 * hidden from assistive technology on a wrapper, since an image drops the
 * props that would hide it. Reduced motion holds it still.
 */

import { useEffect, useState } from "react";
import { Animated, Easing, Platform, View } from "react-native";

import { useReducedMotion } from "./motion";
import { brandMark, useTheme } from "./theme";

const INK = require("../../assets/brand/cart-ink.webp");
const FLAMES = require("../../assets/brand/cart-flames.webp");

export function BrandMark({ height }: { height: number }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const [flicker] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reducedMotion) return void flicker.setValue(1);
    const step = (toValue: number, share: number) =>
      Animated.timing(flicker, { toValue, duration: brandMark.flicker * share, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" });
    // Uneven steps, so the fire never beats like a metronome.
    const loop = Animated.loop(Animated.sequence([step(0, 1), step(0.7, 0.6), step(0.2, 0.5), step(1, 0.9)]));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, flicker]);
  const width = Math.round(height * brandMark.aspect);
  const size = { position: "absolute" as const, width, height };
  const between = (range: readonly [number, number]) => flicker.interpolate({ inputRange: [0, 1], outputRange: [...range] });
  return (
    <View aria-hidden accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width, height }}>
      <Animated.Image
        source={FLAMES}
        resizeMode="contain"
        style={{
          ...size,
          opacity: between(brandMark.flameOpacity),
          // Grown from the cart, where the fire starts, not from its tip.
          transformOrigin: "right",
          transform: [{ translateX: between([brandMark.flameDrift, 0]) }, { scaleX: between(brandMark.flameScale) }],
        }}
      />
      <Animated.Image
        source={INK}
        resizeMode="contain"
        style={{ ...size, tintColor: palette.textStrong, transform: [{ translateY: between([0, brandMark.rattle]) }] }}
      />
    </View>
  );
}
