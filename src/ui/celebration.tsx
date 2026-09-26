/**
 * The finished shop's celebration (`docs/SPEC.md` 3.11, `docs/UI.md` section
 * 7): confetti falls, the summary card springs in and its total counts up. It
 * is an event, so it plays once per finish; a tap skips it and it leaves on
 * its own, and under reduced motion it is the card with its tick. The undo bar
 * is drawn over it, so the finish can still be taken back while it plays.
 */

import { useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Check from "lucide-react-native/icons/check";
import { create } from "zustand";

import { useShops } from "../data/hooks";
import { formatMinor, spentByMonth } from "../domain/money";
import { tr } from "../i18n/tr";
import { MONTHS, MonthBars } from "./charts";
import { SuccessPop, cardEdge } from "./components";
import { useCountUp, useReducedMotion } from "./motion";
import {
  celebration,
  circle,
  iconSize,
  iconStroke,
  motion,
  spacing,
  themeShadow,
  type,
  useTheme,
  type Palette,
} from "./theme";

export interface ShopSummary {
  bought: number;
  /** What the basket's prices came to; `null` when nothing was priced. */
  spentMinor: number | null;
  /** What was not bought and stays on the list. */
  stayed: number;
}

const useCelebration = create<{ summary: ShopSummary | null }>(() => ({
  summary: null,
}));

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function hideCelebration(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  useCelebration.setState({ summary: null });
}

export function celebrate(summary: ShopSummary): void {
  if (hideTimer) clearTimeout(hideTimer);
  useCelebration.setState({ summary });
  hideTimer = setTimeout(hideCelebration, motion.celebration.hold);
}

export function CelebrationHost() {
  const summary = useCelebration((state) => state.summary);
  return summary ? <Celebration summary={summary} /> : null;
}

function Celebration({ summary }: { summary: ShopSummary }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  // The month is read here, once the finish has written its shop: the list
  // screen has no reason to watch every shop.
  const months = spentByMonth(useShops().data, new Date(), MONTHS);
  const month = months.at(-1)!.spentMinor;
  const spent = useCountUp(summary.spentMinor ?? 0, 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.celebration.skip}
      onPress={hideCelebration}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
      }}
    >
      {reducedMotion ? null : <Confetti palette={palette} />}
      <View style={{ width: "100%", maxWidth: celebration.cardWidth }}>
        <SuccessPop>
          <View
            accessibilityLiveRegion="polite"
            style={{
              ...cardEdge(palette),
              ...themeShadow.overlay(palette),
              padding: spacing.xl,
              alignItems: "center",
              gap: spacing.sm,
              backgroundColor: palette.surface,
            }}
          >
            <View
              style={{
                width: celebration.tick,
                height: celebration.tick,
                borderRadius: circle(celebration.tick),
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: palette.success,
                marginBottom: spacing.xs,
              }}
            >
              <Check
                accessible={false}
                size={iconSize.headerBack}
                color={palette.surface}
                strokeWidth={iconStroke.mark}
              />
            </View>
            <Text style={[type.heading, { color: palette.textStrong }]}>
              {tr.celebration.title}
            </Text>
            {summary.spentMinor == null ? null : (
              <Text style={[type.amount, { color: palette.textStrong }]}>
                {formatMinor(spent)}
              </Text>
            )}
            <Text
              style={[type.body, { color: palette.text, textAlign: "center" }]}
            >
              {tr.celebration.bought(summary.bought)}
            </Text>
            {summary.stayed > 0 ? (
              <Text
                style={[
                  type.body,
                  { color: palette.textSecondary, textAlign: "center" },
                ]}
              >
                {tr.celebration.stayed(summary.stayed)}
              </Text>
            ) : null}
            {month == null ? null : (
              <>
                <Text style={[type.small, { color: palette.textSecondary }]}>
                  {tr.celebration.month(formatMinor(month))}
                </Text>
                {/* Mounted with the card, so the bars rise with it; this month is the one marked. */}
                <View style={{ alignSelf: "stretch", marginTop: spacing.sm }}>
                  <MonthBars months={months} />
                </View>
              </>
            )}
          </View>
        </SuccessPop>
      </View>
    </Pressable>
  );
}

// Two steps of the plastic number's low-discrepancy sequence: where a piece
// falls from and when it starts are spread evenly and independently, so the
// fall looks scattered, lays out the same every time and has no randomness in
// render. One sequence for both drew the pieces as a diagonal line.
const ACROSS = 0.7548776662;
const LATER = 0.5698402910;

/** One driver for every piece: each reads its own stretch of the fall from it. */
function Confetti({ palette }: { palette: Palette }) {
  const { width, height } = useWindowDimensions();
  const [fall] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(fall, {
      toValue: 1,
      duration: motion.celebration.fall,
      easing: Easing.linear,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [fall]);
  const colours = [
    palette.primary,
    palette.secondary,
    palette.tertiary,
    palette.success,
    palette.warning,
  ];
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: celebration.pieces }, (_, at) => {
        const x = (0.5 + at * ACROSS) % 1;
        const later = (0.5 + at * LATER) % 1;
        const start = later * 0.35;
        const drift = (x - 0.5) * width * 0.25;
        return (
          <Animated.View
            key={at}
            style={{
              position: "absolute",
              left: x * width,
              top: -celebration.piece.height * 2,
              width: celebration.piece.width,
              height: celebration.piece.height,
              borderRadius: celebration.piece.width / 4,
              backgroundColor: colours[at % colours.length],
              opacity: fall.interpolate({
                inputRange: [0, start, 0.85, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  translateY: fall.interpolate({
                    inputRange: [start, 1],
                    outputRange: [0, height * (0.75 + later * 0.35)],
                    extrapolateLeft: "clamp",
                  }),
                },
                {
                  translateX: fall.interpolate({
                    inputRange: [start, 1],
                    outputRange: [0, drift],
                    extrapolateLeft: "clamp",
                  }),
                },
                {
                  rotate: fall.interpolate({
                    inputRange: [0, 1],
                    outputRange: [
                      "0deg",
                      `${(at % 2 ? 1 : -1) * (180 + x * 360)}deg`,
                    ],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
