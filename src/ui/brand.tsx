/**
 * Gital's mark, the woven G with its leaf, drawn as vectors so it is sharp at
 * any size and can draw itself: the brand kit's timeline (2026-09-28) traces
 * the G under a widening mask, then opens the leaf from its stem. Once the
 * intro ends the mask is dropped, so the resting mark is the kit's exact
 * drawing. The G takes the palette's accent, as the kit's petrol and servi
 * marks do. Decoration: hidden from assistive technology on a wrapper, since
 * an SVG drops the props that would hide it. Reduced motion draws it at rest.
 */

import { useEffect, useId, useState } from "react";
import { Easing, View } from "react-native";
import Svg, { ClipPath, Defs, G, Mask, Path } from "react-native-svg";

import { ASPECT, G as G_SHAPE, G_DRAW, G_DRAW_LENGTH, G_DRAW_WIDTH, LEAF, LEAF_PIVOT, LEAF_TRANSFORM, VIEW_BOX, WEAVE_DARK, WEAVE_LIGHT, WEAVE_OUTLINE } from "./brand-art";
import { useReducedMotion } from "./motion";
import { brandMark, PALETTES, useTheme } from "./theme";

const easeOut = Easing.bezier(0, 0, 0.58, 1);

/**
 * Milliseconds into the intro, or null once it is over. React state rather
 * than an animated value: a mask's stroke is not a prop the native driver can
 * reach, and a second of re-renders on one small tree costs nothing.
 */
function useIntro(duration: number): number | null {
  const reducedMotion = useReducedMotion();
  const [elapsed, setElapsed] = useState<number | null>(0);
  useEffect(() => {
    if (reducedMotion) return;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const now = Date.now() - start;
      if (now >= duration) return setElapsed(null);
      setElapsed(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, duration]);
  return reducedMotion ? null : elapsed;
}

export function BrandMark({ height }: { height: number }) {
  const { paletteId } = useTheme();
  const elapsed = useIntro(brandMark.leafAt + brandMark.leaf);
  // `useId` answers with colons, which a `url(#…)` reference cannot hold.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const progress = (start: number, duration: number) => (elapsed === null ? 1 : easeOut(Math.min(1, Math.max(0, (elapsed - start) / duration))));
  const drawn = progress(0, brandMark.draw);
  const leaf = progress(brandMark.leafAt, brandMark.leaf);
  const [x, y] = LEAF_PIVOT;
  const width = Math.round(height * ASPECT);
  return (
    <View aria-hidden accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width, height }}>
      <Svg width={width} height={height} viewBox={VIEW_BOX}>
        <Defs>
          <ClipPath id={`${id}c`}>
            <Path d={G_SHAPE} />
          </ClipPath>
          {elapsed !== null && (
            <Mask id={`${id}m`}>
              <Path
                d={G_DRAW}
                fill="none"
                stroke={brandMark.reveal}
                strokeWidth={G_DRAW_WIDTH}
                strokeLinejoin="round"
                strokeDasharray={[G_DRAW_LENGTH, G_DRAW_LENGTH]}
                strokeDashoffset={G_DRAW_LENGTH * (1 - drawn)}
              />
            </Mask>
          )}
        </Defs>
        <G mask={elapsed === null ? undefined : `url(#${id}m)`}>
          <Path d={G_SHAPE} fill={PALETTES[paletteId].light.primary} fillRule="evenodd" />
          <G clipPath={`url(#${id}c)`}>
            <Path d={WEAVE_LIGHT} fill={brandMark.weave} stroke={brandMark.weave} strokeWidth={WEAVE_OUTLINE} strokeLinejoin="round" />
            <Path d={WEAVE_DARK} fill={brandMark.weaveShade} stroke={brandMark.weaveShade} strokeWidth={WEAVE_OUTLINE} strokeLinejoin="round" />
          </G>
        </G>
        {leaf > 0 && (
          <G transform={`translate(${x} ${y}) rotate(${-brandMark.leafTurn * (1 - leaf)}) scale(${leaf}) translate(${-x} ${-y})`}>
            <Path d={LEAF} fill={brandMark.leafInk} fillRule="evenodd" transform={LEAF_TRANSFORM} />
          </G>
        )}
      </Svg>
    </View>
  );
}
