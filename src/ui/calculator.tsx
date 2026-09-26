/**
 * The price field and the quantity that open Helix's calculator (`docs/SPEC.md` 4.4). The pad
 * is `./calculator-sheet`, its own chunk on the web, so the entry carries
 * neither it nor its arithmetic. `React.lazy` was rejected: it keeps a failed
 * load for the session, and offline, before the worker has the chunk, the
 * load fails.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import CalculatorIcon from "lucide-react-native/icons/calculator";

import { formatQuantity, type Quantity, type Unit } from "../domain/items";
import { formatMinorInput, formatPriceInput } from "../domain/money";
import { tr } from "../i18n/tr";
import { TextField } from "./components";
import { appError } from "./dialog";
import { interactionSurface } from "./interaction";
import { Press } from "./press";
import { controlSize, font, iconSize, iconStroke, itemPanel, radius, spacing, type, useTheme } from "./theme";

type Sheet = typeof import("./calculator-sheet").default;
const loadSheet = () => import("./calculator-sheet").then((module) => module.default);

/**
 * A field that takes a price in kuruş, typed the Turkish way or worked out on
 * the calculator at its trailing edge, whose result writes back.
 */
export function PriceField({
  value,
  onChangeText,
  label,
  style,
  ...props
}: Omit<TextInputProps, "value" | "onChangeText" | "style"> & {
  value: string;
  onChangeText: (typed: string) => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const [open, sheet] = useCalculator(undefined, (minor) => onChangeText(formatMinorInput(minor)));
  return (
    <View style={style}>
      <TextField
        {...props}
        value={value}
        onChangeText={(typed) => onChangeText(formatPriceInput(typed))}
        accessibilityLabel={label}
        keyboardType="decimal-pad"
        inputMode="decimal"
        style={{ paddingRight: controlSize.minimumTarget }}
      />
      {/* Helix's accessory: the bare mark, centred in the field's own right
          padding, its box the whole 44-point column so the web has a target
          `hitSlop` would not give it. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr.calc.open(label)}
        onPress={open}
        style={(state) => ({
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: controlSize.minimumTarget,
          alignItems: "center",
          justifyContent: "center",
          borderTopRightRadius: radius.sm,
          borderBottomRightRadius: radius.sm,
          ...interactionSurface(palette, state),
        })}
      >
        <CalculatorIcon accessible={false} size={iconSize.control} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
      </Pressable>
      {sheet}
    </View>
  );
}

/**
 * A quantity that opens the calculator, drawn as a field's own face so the
 * number reads as something to edit, as tall as the − and + faces beside it
 * inside the same target.
 */
export function QuantityFace({ quantity, quiet = false, onPress }: { quantity: Quantity; quiet?: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={tr.calc.open(`${tr.items.quantity} ${formatQuantity(quantity)}`)}
      onPress={onPress}
      style={{ minWidth: itemPanel.quantityWidth, minHeight: controlSize.minimumTarget, justifyContent: "center" }}
    >
      {(state) => (
        <View
          style={{
            height: controlSize.compact,
            paddingHorizontal: spacing.sm,
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            borderRadius: radius.sm,
            ...interactionSurface(palette, state, { base: palette.surfaceAlt }),
          }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={[type.body, { fontFamily: font.medium, textAlign: "center", color: quiet ? palette.textSecondary : palette.text }]}
          >
            {formatQuantity(quantity)}
          </Text>
        </View>
      )}
    </Press>
  );
}

/**
 * What opens the calculator and the sheet it opens, for a price or, given a
 * `unit`, a quantity in thousandths of it; the result is handed to `onResult`.
 */
export function useCalculator(unit: Unit | undefined, onResult: (value: number) => void): [open: () => void, sheet: ReactNode] {
  const [Sheet, setSheet] = useState<Sheet | null>(null);
  // Fetched while the field is on screen, so the worker has the chunk before
  // the first offline start rather than only after the first calculation.
  useEffect(() => void loadSheet().catch(() => {}), []);
  const open = () => {
    Keyboard.dismiss();
    loadSheet().then(
      (loaded) => setSheet(() => loaded),
      () => void appError(tr.errors.openFailed),
    );
  };
  const sheet = Sheet ? (
    <Sheet
      unit={unit}
      onClose={() => setSheet(null)}
      onResult={(value) => {
        onResult(value);
        setSheet(null);
      }}
    />
  ) : null;
  return [open, sheet];
}
