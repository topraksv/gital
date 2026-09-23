/**
 * Changing the whole window's colour without it reading as a reload, ported
 * from Helix's `theme-transition.ts` and `ThemeDissolve`. Helix tried an
 * instant swap ("tak diye değişiyor") and a full-screen veil over the new
 * theme ("still feels like a refresh") before this.
 *
 * Where the browser has View Transitions it cross-fades the real pixels.
 * Everywhere else the PREVIOUS background is laid over the new theme and
 * fades: a veil in the new colour cannot soften a dark-to-light edge, the old
 * one can. The old background is armed before the preference commits, so the
 * veil is present in the first native frame of the new palette.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, type ViewStyle } from "react-native";
import { useReducedMotion } from "./motion";
import { motion, useTheme } from "./theme";

type ViewTransitionStarter = { startViewTransition?: (callback: () => void) => unknown };

let pendingBackground: string | null = null;

function viewTransitionDocument(): ViewTransitionStarter | null {
  return typeof document === "undefined" ? null : (document as unknown as ViewTransitionStarter);
}

function crossFadesNatively(): boolean {
  return typeof viewTransitionDocument()?.startViewTransition === "function";
}

export function applyThemeChange(commit: () => void, fromBackground: string): void {
  const doc = viewTransitionDocument();
  if (!doc || typeof doc.startViewTransition !== "function") {
    pendingBackground = fromBackground;
    commit();
    return;
  }
  pendingBackground = null;
  let committed = false;
  const commitOnce = () => {
    if (committed) return;
    committed = true;
    commit();
  };
  try {
    // React 19 flushes a click synchronously, so the commit lands before the
    // browser's "after" snapshot. Helix tried `flushSync` via a dynamic import
    // first; in the Metro web bundle it never resolved and the theme stopped changing.
    doc.startViewTransition(commitOnce);
  } catch {
    // A backgrounded document can refuse a transition; the preference still applies.
    commitOnce();
  }
}

/** Light enough to keep the interface legible through the change. */
const VEIL_STRENGTH = 0.42;

// A layout effect, or the new theme paints un-veiled for one frame. Chosen at
// module scope so hook order never changes and a static web render never calls it.
const useThemeChangeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Rendered last in the root, so the palette being left covers everything while it fades. */
export function ThemeDissolve() {
  // Out of the React Compiler: this reads `pendingBackground`, armed outside
  // React so the veil is up in the first frame, and the compiler cached the
  // veil's style on its hook inputs alone. Compiled, the native fade froze at
  // full strength and then vanished; Helix's `peek` call is cached at mount,
  // so its first frame is never veiled at all.
  "use no memo";
  const { palette, scheme, paletteId, preference } = useTheme();
  const reducedMotion = useReducedMotion();
  const identity = `${paletteId}|${scheme}`;
  const previous = useRef(identity);
  const previousBackground = useRef(palette.background);
  const browserCrossFades = crossFadesNatively();
  const [progress] = useState(() => new Animated.Value(0));
  const [from, setFrom] = useState<string | null>(null);
  const [webFade, setWebFade] = useState<"visible" | "fading">("fading");
  const prepared = pendingBackground;
  const veil = from ?? prepared;

  // Keyed on `preference` too: a choice that resolves to the scheme already
  // showing still armed the veil, and only this effect disarms it.
  useThemeChangeEffect(() => {
    const before = previous.current;
    const background = pendingBackground ?? previousBackground.current;
    pendingBackground = null;
    previous.current = identity;
    previousBackground.current = palette.background;
    if (before === identity || reducedMotion || browserCrossFades) {
      setFrom(null);
      setWebFade("fading");
      return;
    }
    setFrom(background);
    // RN Web's JS-driven Animated repaints a full-screen opacity every frame and
    // hitches against the theme repaint; mount the veil once and let CSS fade it.
    if (Platform.OS === "web") {
      setWebFade("visible");
      const frame = window.requestAnimationFrame(() => setWebFade("fading"));
      const timer = window.setTimeout(() => setFrom(null), motion.theme + motion.fadeTail);
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(timer);
        setFrom(null);
      };
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.theme,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setFrom(null);
    });
    return () => {
      animation.stop();
      setFrom(null);
    };
  }, [identity, preference, palette.background, progress, reducedMotion, browserCrossFades]);

  if (!veil) return null;
  return (
    <Animated.View
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: veil },
        Platform.OS === "web"
          ? ({
              opacity: webFade === "visible" || Boolean(prepared) ? VEIL_STRENGTH : 0,
              transitionProperty: "opacity",
              transitionDuration: `${motion.theme}ms`,
              transitionTimingFunction: motion.webEase,
              willChange: "opacity",
            } as unknown as ViewStyle)
          : { opacity: prepared ? VEIL_STRENGTH : progress.interpolate({ inputRange: [0, 1], outputRange: [VEIL_STRENGTH, 0] }) },
      ]}
    />
  );
}
