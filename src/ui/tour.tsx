/**
 * The first-open tour (`docs/SPEC.md` 13.2), Helix's `tour.tsx`: one short
 * slide per thing Gital does, each over a drawing of the screen it names. It
 * opens once, the first time Listeler is shown on this device, and Ayarlar
 * plays it again. Back, skip and next, because Helix measured that a tour with
 * no way back makes a skimmed slide cost the whole tour.
 *
 * The device flag decides on its own until accounts: with them, a sign-in to
 * an account that already has lists must not introduce Gital again (Helix's
 * `isNewSignup`).
 */

import { useEffect, useState, type ReactNode } from "react";
import { Text, View, type DimensionValue } from "react-native";
import Check from "lucide-react-native/icons/check";
import Plus from "lucide-react-native/icons/plus";

import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { useModalAccessibility } from "./accessibility";
import { Button, SlideUp } from "./components";
import { Actions, DialogShell } from "./dialog";
import { circle, font, iconSize, iconStroke, motion, radius, spacing, tour, type, useTheme, type Palette } from "./theme";

const SEEN_KEY = "gital.tour.seen";
const SLIDES = tr.tour.slides;

/** Mounted on Listeler: the one screen every first open reaches. */
export function FirstRunTour() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void kv.get(SEEN_KEY).then((seen) => setOpen(seen !== "true"));
  }, []);
  if (!open) return null;
  return (
    <TourModal
      onClose={() => {
        setOpen(false);
        void kv.set(SEEN_KEY, "true");
      }}
    />
  );
}

export function TourModal({ onClose }: { onClose: () => void }) {
  const { palette } = useTheme();
  const [step, setStep] = useState(0);
  const titleRef = useModalAccessibility(true, step);
  const slide = SLIDES[step]!;
  const last = step === SLIDES.length - 1;
  return (
    <DialogShell
      title={slide.title}
      titleRef={titleRef}
      onDismiss={onClose}
      lead={
        <SlideUp key={step} distance={motion.travel.rise}>
          <Artwork step={step} palette={palette} />
        </SlideUp>
      }
    >
      <View accessible accessibilityLabel={tr.tour.step(step + 1, SLIDES.length, slide.title)} accessibilityLiveRegion="polite" style={{ minHeight: tour.text }}>
        <Text style={[type.body, { color: palette.textSecondary }]}>{slide.body}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg }}>
        <Text style={[type.small, { color: palette.textSecondary, fontFamily: font.semibold }]}>{`${step + 1} / ${SLIDES.length}`}</Text>
        <View accessible={false} style={{ flexDirection: "row", gap: spacing.xs }}>
          {SLIDES.map((_, at) => (
            <View
              key={at}
              style={{
                width: at === step ? tour.dot.active : tour.dot.width,
                height: tour.line,
                borderRadius: circle(tour.line),
                backgroundColor: at === step ? palette.primary : palette.border,
              }}
            />
          ))}
        </View>
      </View>
      <Actions>
        {step > 0 ? <Button label={tr.tour.back} variant="ghost" size="sm" onPress={() => setStep(step - 1)} /> : null}
        {last ? null : <Button label={tr.tour.skip} variant="ghost" size="sm" onPress={onClose} />}
        <Button label={last ? tr.tour.start : tr.tour.next} size="sm" onPress={() => (last ? onClose() : setStep(step + 1))} />
      </Actions>
    </DialogShell>
  );
}

/** A skeleton line of text: a width, and the ink it stands for. */
function Line({ width, color }: { width: DimensionValue; color: string }) {
  return <View style={{ width, height: tour.line, borderRadius: circle(tour.line), backgroundColor: color }} />;
}

/** A row as the list draws it: its picture, its name, and its circle ticked or not. */
function Row({ palette, ticked = false, width }: { palette: Palette; ticked?: boolean; width: DimensionValue }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.xs, borderRadius: radius.sm, backgroundColor: palette.surface }}>
      <View style={{ width: tour.block, height: tour.block, borderRadius: radius.sm, backgroundColor: palette.primarySoft }} />
      <View style={{ flex: 1 }}>
        <Line width={width} color={ticked ? palette.textMuted : palette.textSecondary} />
      </View>
      <Mark palette={palette} ticked={ticked} size={tour.block} />
    </View>
  );
}

function Mark({ palette, ticked, size }: { palette: Palette; ticked: boolean; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: circle(size),
        alignItems: "center",
        justifyContent: "center",
        borderWidth: ticked ? 0 : tour.line / 2,
        borderColor: palette.border,
        backgroundColor: ticked ? palette.secondary : undefined,
      }}
    >
      {ticked ? <Check accessible={false} size={iconSize.compact} color={palette.onSecondary} strokeWidth={iconStroke.mark} /> : null}
    </View>
  );
}

function Frame({ palette, children }: { palette: Palette; children: ReactNode }) {
  return (
    <View
      accessible={false}
      style={{
        height: tour.art,
        overflow: "hidden",
        borderRadius: radius.lg,
        backgroundColor: palette.surfaceAlt,
        padding: spacing.md,
        justifyContent: "center",
        gap: spacing.xs,
        marginBottom: spacing.lg,
      }}
    >
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: tour.line, backgroundColor: palette.primary }} />
      {children}
    </View>
  );
}

function Artwork({ step, palette }: { step: number; palette: Palette }) {
  if (step === 0) {
    // Lists: cards in their own colours.
    const tones = [palette.primarySoft, palette.secondarySoft, palette.tertiarySoft];
    return (
      <Frame palette={palette}>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {tones.map((tone, at) => (
            <View key={at} style={{ flex: 1, gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface }}>
              <View style={{ width: tour.mark, height: tour.mark, borderRadius: radius.sm, backgroundColor: tone }} />
              <Line width="80%" color={palette.textStrong} />
              <Line width="50%" color={palette.textSecondary} />
            </View>
          ))}
        </View>
      </Frame>
    );
  }
  if (step === 1) {
    // The one field, and what it made.
    return (
      <Frame palette={palette}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: palette.surface }}>
            <Line width="70%" color={palette.textSecondary} />
          </View>
          <View style={{ width: tour.mark, height: tour.mark, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary }}>
            <Plus accessible={false} size={iconSize.control} color={palette.onPrimary} strokeWidth={iconStroke.mark} />
          </View>
        </View>
        <Row palette={palette} width="45%" />
        <Row palette={palette} width="30%" />
      </Frame>
    );
  }
  if (step === 2) {
    // The aisle: what is taken is ticked, what is left is not.
    return (
      <Frame palette={palette}>
        <Row palette={palette} width="40%" />
        <Row palette={palette} ticked width="55%" />
        <Row palette={palette} ticked width="35%" />
      </Frame>
    );
  }
  if (step === 3) {
    // The finish: the card that celebrates it.
    return (
      <Frame palette={palette}>
        <View style={{ alignSelf: "center", alignItems: "center", gap: spacing.xs, padding: spacing.sm, width: "60%", borderRadius: radius.md, backgroundColor: palette.surface }}>
          <Mark palette={{ ...palette, secondary: palette.success }} ticked size={tour.mark} />
          <Line width="70%" color={palette.textStrong} />
          <Line width="45%" color={palette.textSecondary} />
        </View>
      </Frame>
    );
  }
  // What it remembers: a price's history and the offers under the field.
  return (
    <Frame palette={palette}>
      <View style={{ gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface }}>
        <Line width="60%" color={palette.textSecondary} />
        <Line width="40%" color={palette.warning} />
      </View>
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        {["30%", "25%", "20%"].map((width) => (
          <View key={width} style={{ width: width as DimensionValue, padding: spacing.sm, borderRadius: radius.full, backgroundColor: palette.primarySoft }}>
            <Line width="80%" color={palette.primaryText} />
          </View>
        ))}
      </View>
    </Frame>
  );
}
