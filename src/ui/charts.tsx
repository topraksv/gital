/**
 * Gital's charts (`docs/SPEC.md` 11.8, `docs/UI.md` section 12): six months'
 * totals, the month's aisles, a product's price over time and a shop's
 * progress as a ring. Helix's
 * grammar — its bar shape, line weight and markers — without its chart module,
 * whose axes, focus and scrubbing serve a finance app's long series: these are
 * six bars, six points and one share, each with its figures written as text.
 *
 * A mark mounted as an event grows from nothing; one arriving with its screen
 * is drawn where it stands, and after that it springs from what was last
 * drawn to the new value (`docs/UI.md` section 7).
 */

import { useState } from "react";
import { Animated, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

import { formatMinor, formatMinorShort } from "../domain/money";
import { tr } from "../i18n/tr";
import { useArrivesMoving } from "./components";
import { useSpringTo } from "./motion";
import { borderWidth, chart, circle, font, radius, spacing, type, useTheme } from "./theme";

type Month = { start: string; spentMinor: number | null };

/** Six months, so a season shows and a phone's width still gives each month its figure; `tr.history.months` names it. */
export const MONTHS = 6;

/** A share that grows from nothing when it mounts as an event, and springs to each new value after. */
function useShare(share: number, native = true): Animated.Value {
  const moving = useArrivesMoving();
  const [value] = useState(() => new Animated.Value(moving ? 0 : share));
  useSpringTo(value, share, native);
  return value;
}

/** What each of the last six months cost, this one last and marked; the figures sit under their bars. */
export function MonthBars({ months }: { months: readonly Month[] }) {
  const top = Math.max(...months.map((month) => month.spentMinor ?? 0));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={tr.history.monthsLabel(months)} style={{ flexDirection: "row", gap: spacing.xs }}>
      {months.map((month, at) => (
        <MonthBar
          key={month.start}
          month={month}
          share={!month.spentMinor || top === 0 ? 0 : Math.max(chart.barFloor, month.spentMinor / top)}
          current={at === months.length - 1}
        />
      ))}
    </View>
  );
}

function MonthBar({ month, share, current }: { month: Month; share: number; current: boolean }) {
  const { palette } = useTheme();
  const grown = useShare(share);
  const figure = [type.small, { color: current ? palette.textStrong : palette.textSecondary, fontFamily: current ? font.semibold : font.regular, textAlign: "center" as const }];
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: "center", gap: spacing.xs }}>
      {/* Slid up inside a clipped column rather than grown, so the spring runs
          on the native driver and the rounded top stays round. */}
      <View style={{ height: chart.bars, alignSelf: "stretch", alignItems: "center", overflow: "hidden", borderBottomWidth: borderWidth.outline, borderColor: palette.border }}>
        <Animated.View
          style={{
            width: chart.barWidth,
            height: chart.bars,
            borderTopLeftRadius: radius.sm,
            borderTopRightRadius: radius.sm,
            backgroundColor: palette.primary,
            transform: [{ translateY: grown.interpolate({ inputRange: [0, 1], outputRange: [chart.bars, 0] }) }],
          }}
        />
      </View>
      <Text numberOfLines={1} style={figure}>
        {tr.history.month(month.start)}
      </Text>
      <Text numberOfLines={1} style={figure}>
        {month.spentMinor == null ? "—" : formatMinorShort(month.spentMinor)}
      </Text>
    </View>
  );
}

/** What each aisle cost this month, the dearest first, each as a bar against the dearest with its figure. */
export function AisleShares({ rows }: { rows: readonly { name: string; spentMinor: number }[] }) {
  const top = Math.max(...rows.map((row) => row.spentMinor));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={tr.history.aislesLabel(rows)} style={{ gap: spacing.md }}>
      {rows.map((row) => (
        <AisleShare key={row.name} row={row} share={top === 0 ? 0 : Math.max(chart.barFloor, row.spentMinor / top)} />
      ))}
    </View>
  );
}

function AisleShare({ row, share }: { row: { name: string; spentMinor: number }; share: number }) {
  const { palette } = useTheme();
  // A width in percent, which only the JS driver animates; a handful of bars.
  const grown = useShare(share, false);
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
        <Text numberOfLines={1} style={[type.small, { flex: 1, minWidth: 0, color: palette.text }]}>
          {row.name}
        </Text>
        <Text style={[type.small, { color: palette.textStrong, fontFamily: font.semibold }]}>{formatMinorShort(row.spentMinor)}</Text>
      </View>
      <View style={{ height: chart.track, borderRadius: circle(chart.track), backgroundColor: palette.surfaceAlt, overflow: "hidden" }}>
        <Animated.View
          style={{
            height: chart.track,
            borderRadius: circle(chart.track),
            backgroundColor: palette.primary,
            width: grown.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          }}
        />
      </View>
    </View>
  );
}

/** A product's last prices, oldest first, as a line with a marker on each; the first and the last are written under its ends. */
export function PriceLine({ prices }: { prices: readonly number[] }) {
  const { palette } = useTheme();
  const [width, setWidth] = useState(0);
  const low = Math.min(...prices);
  const span = Math.max(...prices) - low;
  const inset = chart.marker + chart.lineWidth;
  const points = prices.map((price, at) => ({
    x: inset + (at * (width - inset * 2)) / (prices.length - 1),
    // A price that never moved is a level line through the middle, not the floor.
    y: span === 0 ? chart.line / 2 : inset + (1 - (price - low) / span) * (chart.line - inset * 2),
  }));
  const ends = [type.small, { color: palette.textSecondary }];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={tr.items.lastPrices(prices)} style={{ gap: spacing.xs }}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height: chart.line }}>
        {width > 0 ? (
          <Svg width={width} height={chart.line}>
            <Polyline
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={palette.primary}
              strokeWidth={chart.lineWidth}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((point, at) => (
              <Circle
                key={at}
                cx={point.x}
                cy={point.y}
                r={chart.marker}
                fill={at === points.length - 1 ? palette.primary : palette.surface}
                stroke={palette.primary}
                strokeWidth={chart.lineWidth}
              />
            ))}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={ends}>{formatMinor(prices[0]!)}</Text>
        <Text style={[ends, { color: palette.textStrong, fontFamily: font.semibold }]}>{formatMinor(prices.at(-1)!)}</Text>
      </View>
    </View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * How far a shop has got, as a ring on its list's card. Decoration: the card's
 * line says it in words. The arc is a dash offset, which only the JS driver
 * animates — one element per card keeps that cheap.
 */
export function ProgressRing({ value }: { value: number }) {
  const { palette } = useTheme();
  const drawn = useShare(value, false);
  const r = circle(chart.ring) - chart.ringWidth / 2;
  const length = 2 * Math.PI * r;
  const middle = circle(chart.ring);
  return (
    <View accessible={false} style={{ width: chart.ring, height: chart.ring, transform: [{ rotate: "-90deg" }] }}>
      <Svg width={chart.ring} height={chart.ring}>
        <Circle cx={middle} cy={middle} r={r} fill="none" stroke={palette.surfaceAlt} strokeWidth={chart.ringWidth} />
        <AnimatedCircle
          cx={middle}
          cy={middle}
          r={r}
          fill="none"
          stroke={value === 1 ? palette.success : palette.secondary}
          strokeWidth={chart.ringWidth}
          // A round cap at nothing drawn would still paint a dot.
          strokeLinecap={value > 0 ? "round" : "butt"}
          strokeDasharray={`${length} ${length}`}
          strokeDashoffset={drawn.interpolate({ inputRange: [0, 1], outputRange: [length, 0] })}
        />
      </Svg>
    </View>
  );
}
