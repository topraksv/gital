/**
 * The cold start: the native splash hands over to the mark drawing itself on
 * the ground, and the app comes up from under it once it is ready and the
 * drawing is done and has rested — whichever is later, so a ready app waits
 * no longer than `brandMark.launch`. It lives as long as the root layout and leaves once, so coming
 * back from the background never replays it. Reduced motion shows the mark at
 * rest and removes the screen without a fade the moment the app is ready.
 */

import { useEffect, useState } from "react";
import { Animated, Platform, StyleSheet, type ViewStyle } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { BrandMark } from "./brand";
import { ASPECT } from "./brand-art";
import { useReducedMotion } from "./motion";
import { brandMark, motion, useTheme } from "./theme";

/**
 * `imageWidth` of the expo-splash-screen plugin in `app.json`: the native
 * splash centres `assets/brand/splash.png` (the mark's own view box) at this
 * width, so the drawn mark takes over at the same place and size.
 */
const SPLASH_IMAGE_WIDTH = 150;

/** `shown` waits for the palette; `ready` is the app's first screen drawn under this one. */
export function Launch({ shown, ready }: { shown: boolean; ready: boolean }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  const [gone, setGone] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));
  const done = ready && (drawn || reducedMotion);

  useEffect(() => {
    if (!shown || reducedMotion) return;
    const timer = setTimeout(() => setDrawn(true), brandMark.launch.draw + brandMark.launch.rest);
    return () => clearTimeout(timer);
  }, [shown, reducedMotion]);

  useEffect(() => {
    if (!done) return;
    // Under reduced motion this screen can unmount before its layout event
    // arrives; the splash must never outlive it, and a second hide is a no-op.
    SplashScreen.hide();
    // RN Web's JS-driven opacity repaints the whole window every frame while
    // the first screen mounts under it; CSS fades it off the main thread, as
    // the theme veil does.
    if (Platform.OS === "web" || reducedMotion) {
      const timer = setTimeout(() => setGone(true), reducedMotion ? 0 : brandMark.launch.fade + motion.fadeTail);
      return () => clearTimeout(timer);
    }
    const animation = Animated.timing(opacity, { toValue: 0, duration: brandMark.launch.fade, useNativeDriver: true });
    animation.start(({ finished }) => finished && setGone(true));
    return () => animation.stop();
  }, [done, reducedMotion, opacity]);

  if (!shown || gone) return null;
  const leaving = done && !reducedMotion;
  return (
    <Animated.View
      // Hidden only once a frame of this screen is laid out, so the native
      // splash gives way to the same ground with no blank frame between.
      onLayout={() => SplashScreen.hide()}
      pointerEvents={leaving ? "none" : "auto"}
      style={[
        StyleSheet.absoluteFill,
        { alignItems: "center", justifyContent: "center", backgroundColor: palette.background },
        Platform.OS === "web"
          ? ({
              opacity: leaving ? 0 : 1,
              transitionProperty: "opacity",
              transitionDuration: `${brandMark.launch.fade}ms`,
              transitionTimingFunction: motion.webEase,
            } as unknown as ViewStyle)
          : { opacity },
      ]}
    >
      <BrandMark height={SPLASH_IMAGE_WIDTH / ASPECT} duration={brandMark.launch.draw} />
    </Animated.View>
  );
}
