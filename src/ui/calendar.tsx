/**
 * Helix's calendar (`src/ui/calendar.tsx`): a field that opens a month grid,
 * so a date is picked and never typed. Here the grid is Gital's sheet rather
 * than Helix's centred modal, as the calculator's is, and it opens over the
 * sheet that holds the field.
 */

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import CalendarDays from "lucide-react-native/icons/calendar-days";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";

import { addMonthsToKey, monthCells, monthKeyOf, todayISO, type ISODate } from "../domain/dates";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { IconButton, rowsOf } from "./components";
import { DialogShell } from "./dialog";
import { selectionTapIfChanged } from "./haptics";
import { interactionSurface } from "./interaction";
import { circle, controlSize, font, iconSize, iconStroke, offset, radius, spacing, type, useTheme } from "./theme";
import { Press } from "./press";

const WEEK = 7;

export function DateField({ label, value, onChange }: { label: string; value: ISODate | null; onChange: (day: ISODate) => void }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={value ? tr.calendar.day(value) : tr.calendar.pick}
        aria-expanded={open}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        // The text field's face, so a date reads as a value being entered.
        style={(state) => ({
          minHeight: controlSize.regular,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          borderRadius: radius.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + offset.tight,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          ...interactionSurface(palette, state, { base: palette.surfaceAlt }),
        })}
      >
        <Text style={[type.field, { fontFamily: font.regular, color: value ? palette.text : palette.textSecondary }]}>
          {value ? tr.calendar.day(value) : tr.calendar.pick}
        </Text>
        <CalendarDays accessible={false} size={iconSize.control} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
      </Pressable>
      {open ? (
        <CalendarSheet
          title={label}
          value={value}
          onSelect={(day) => {
            selectionTapIfChanged(value, day);
            onChange(day);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function CalendarSheet({ title, value, onSelect, onClose }: { title: string; value: ISODate | null; onSelect: (day: ISODate) => void; onClose: () => void }) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true);
  const today = todayISO();
  const [month, setMonth] = useState(monthKeyOf(value ?? today));
  const weeks = rowsOf(monthCells(month), WEEK);

  return (
    <DialogShell title={title} titleRef={titleRef} onDismiss={onClose}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md }}>
        <IconButton icon={ChevronLeft} label={tr.calendar.previous} onPress={() => setMonth(addMonthsToKey(month, -1))} />
        <Text accessibilityLiveRegion="polite" style={[type.heading, { color: palette.textStrong }]}>
          {tr.calendar.month(month)}
        </Text>
        <IconButton icon={ChevronRight} label={tr.calendar.next} onPress={() => setMonth(addMonthsToKey(month, 1))} />
      </View>
      <View style={{ flexDirection: "row", marginTop: spacing.sm }}>
        {tr.calendar.weekdays.map((day) => (
          <Text key={day} accessible={false} style={[type.small, { flex: 1, textAlign: "center", color: palette.textSecondary }]}>
            {day}
          </Text>
        ))}
      </View>
      {weeks.map((week, at) => (
        <View key={at} style={{ flexDirection: "row" }}>
          {Array.from({ length: WEEK }, (_, cell) => {
            const day = week[cell] ?? null;
            if (day == null) return <View key={cell} style={{ flex: 1, height: controlSize.minimumTarget }} />;
            const selected = day === value;
            return (
              <Press
                key={day}
                accessibilityRole="button"
                accessibilityLabel={tr.calendar.day(day)}
                accessibilityState={{ selected }}
                onPress={() => onSelect(day)}
                style={{ flex: 1, height: controlSize.minimumTarget, alignItems: "center", justifyContent: "center" }}
              >
                {(state) => (
                  <View
                    style={{
                      width: controlSize.compact,
                      height: controlSize.compact,
                      borderRadius: circle(controlSize.compact),
                      alignItems: "center",
                      justifyContent: "center",
                      ...interactionSurface(palette, state, { base: selected ? palette.primarySoft : "transparent" }),
                      borderWidth: day === today && !selected ? StyleSheet.hairlineWidth : 0,
                      borderColor: palette.accentText,
                    }}
                  >
                    <Text style={[type.body, { color: selected ? palette.accentText : palette.text, fontVariant: ["tabular-nums"] }]}>
                      {Number(day.slice(8))}
                    </Text>
                  </View>
                )}
              </Press>
            );
          })}
        </View>
      ))}
    </DialogShell>
  );
}
