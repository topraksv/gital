/**
 * The finished shop's celebration (`docs/SPEC.md` 3.11, `docs/UI.md` section
 * 7): one card, where the basket was, that pops in with its tick while its
 * total counts up and the month's bars rise, and holds the finish's undo. It
 * is the only thing the finish shows: no confetti, no layer over the page and
 * no undo bar beside it, since the owner found the three at once confusing
 * (2026-10-02). Under reduced motion it is the card at rest.
 */

import { useState } from "react";
import { Text, View } from "react-native";
import Check from "lucide-react-native/icons/check";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";

import { useShops } from "../data/hooks";
import { formatMinor, spentByMonth } from "../domain/money";
import { tr } from "../i18n/tr";
import { MONTHS, MonthBars } from "./charts";
import { Button, SuccessPop, cardEdge } from "./components";
import { selectionTap } from "./haptics";
import { useCountUp } from "./motion";
import { celebration, circle, iconSize, iconStroke, radius, spacing, type, useTheme } from "./theme";

export interface ShopSummary {
  bought: number;
  /** What the basket's prices came to; `null` when nothing was priced. */
  spentMinor: number | null;
  /** What was not bought and stays on the list. */
  stayed: number;
  /** What went to the pantry (SPEC 12.5); none when the list's switch is off. */
  stocked: number;
}

export function FinishedCard({ summary, onUndo }: { summary: ShopSummary; onUndo: () => Promise<void> }) {
  const { palette } = useTheme();
  const [undoing, setUndoing] = useState(false);
  // The month is read here, once the finish has written its shop: the list
  // screen has no reason to watch every shop.
  const months = spentByMonth(useShops().data, new Date(), MONTHS);
  const month = months.at(-1)!.spentMinor;
  const spent = useCountUp(summary.spentMinor ?? 0, 0);
  const undo = async () => {
    if (undoing) return;
    selectionTap();
    setUndoing(true);
    try {
      await onUndo();
    } finally {
      setUndoing(false);
    }
  };
  return (
    <SuccessPop>
      {/* Announced as the undo bar it replaced was: for a screen reader it is the finish's only confirmation. */}
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{
          ...cardEdge(palette),
          alignSelf: "center",
          width: "100%",
          maxWidth: celebration.cardWidth,
          marginTop: spacing.lg,
          borderRadius: radius.xl,
          padding: spacing.lg,
          alignItems: "center",
          gap: spacing.xs,
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
          }}
        >
          <Check accessible={false} size={iconSize.headerBack} color={palette.surface} strokeWidth={iconStroke.mark} />
        </View>
        <Text accessibilityRole="header" aria-level={2} style={[type.heading, { color: palette.textStrong }]}>
          {tr.celebration.title}
        </Text>
        {summary.spentMinor == null ? null : <Text style={[type.heading, { color: palette.textStrong }]}>{formatMinor(spent)}</Text>}
        <Text style={[type.body, { color: palette.text, textAlign: "center" }]}>{tr.celebration.bought(summary.bought)}</Text>
        {summary.stayed > 0 ? (
          <Text style={[type.body, { color: palette.textSecondary, textAlign: "center" }]}>{tr.celebration.stayed(summary.stayed)}</Text>
        ) : null}
        {summary.stocked > 0 ? (
          <Text style={[type.body, { color: palette.textSecondary, textAlign: "center" }]}>{tr.celebration.stocked(summary.stocked)}</Text>
        ) : null}
        {month == null ? null : (
          <>
            <Text style={[type.small, { color: palette.textSecondary }]}>{tr.celebration.month(formatMinor(month))}</Text>
            {/* Mounted with the card, so the bars rise with it; this month is the one marked. */}
            <View style={{ alignSelf: "stretch", marginTop: spacing.sm }}>
              <MonthBars months={months} />
            </View>
          </>
        )}
        <View style={{ marginTop: spacing.sm }}>
          <Button label={tr.common.undo} icon={RotateCcw} variant="ghost" size="sm" loading={undoing} onPress={() => void undo()} />
        </View>
      </View>
    </SuccessPop>
  );
}
