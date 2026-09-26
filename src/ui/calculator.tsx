/**
 * The price field that opens Helix's calculator (`docs/SPEC.md` 4.4). The pad
 * is `./calculator-sheet`, its own chunk on the web, so the entry carries
 * neither it nor its arithmetic. `React.lazy` was rejected: it keeps a failed
 * load for the session, and offline, before the worker has the chunk, the
 * load fails.
 */

import { useEffect, useState } from "react";
import { Keyboard, Pressable, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import CalculatorIcon from "lucide-react-native/icons/calculator";

import { formatMinorInput, formatPriceInput } from "../domain/money";
import { tr } from "../i18n/tr";
import { TextField } from "./components";
import { appError } from "./dialog";
import { interactionSurface } from "./interaction";
import { controlSize, iconSize, iconStroke, radius, useTheme } from "./theme";

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
  const [Sheet, setSheet] = useState<Sheet | null>(null);
  // Fetched while the field is on screen, so the worker has the chunk before
  // the first offline start rather than only after the first calculation.
  useEffect(() => void loadSheet().catch(() => {}), []);
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
        onPress={() => {
          Keyboard.dismiss();
          loadSheet().then(
            (loaded) => setSheet(() => loaded),
            () => void appError(tr.errors.openFailed),
          );
        }}
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
      {Sheet ? (
        <Sheet
          onClose={() => setSheet(null)}
          onResult={(minor) => {
            onChangeText(formatMinorInput(minor));
            setSheet(null);
          }}
        />
      ) : null}
    </View>
  );
}
