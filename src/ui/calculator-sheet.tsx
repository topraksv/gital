/**
 * Helix's calculator (`docs/SPEC.md` 4.4, `docs/UI.md` section 5) in Gital's
 * sheet; the arithmetic is `src/domain/calculator.ts`. Helix's last row, "0"
 * and ",", filled the width, so its "," was wider than every key above it;
 * here the keys sit on a grid measured from the pad's width, "0" spanning two
 * columns and "=" two rows, as a desk calculator's do.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Delete from "lucide-react-native/icons/delete";

import { CALC_START, feedbackOf, formatNumber, keyFrom, minorOf, press, previewOf, resultOf, shownOf, type Calc, type CalcKey } from "../domain/calculator";
import { formatMinor } from "../domain/money";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Button } from "./components";
import { DialogShell } from "./dialog";
import { errorNotice, selectionTap, successNotice } from "./haptics";
import { interactionSurface } from "./interaction";
import { calculatorPad, iconSize, iconStroke, radius, spacing, themeShadow, type, useTheme } from "./theme";

const OPS: readonly CalcKey[] = ["÷", "×", "-", "+", "="];
const FEEDBACK = { none: () => {}, selection: selectionTap, success: successNotice, error: errorNotice } as const;

export default function CalculatorSheet({ onResult, onClose }: { onResult: (minor: number) => void; onClose: () => void }) {
  const titleRef = useModalAccessibility(true);
  const [state, setState] = useState<Calc>(CALC_START);
  const minor = minorOf(resultOf(state));
  const tap = (key: CalcKey) => {
    FEEDBACK[feedbackOf(state, key)]();
    setState((current) => press(current, key));
  };
  useWebKeys(state, tap, minor == null ? null : () => onResult(minor));

  return (
    <DialogShell title={tr.calc.title} titleRef={titleRef} onDismiss={onClose}>
      <Display state={state} />
      <Pad onKey={tap} />
      <View style={{ marginTop: spacing.lg }}>
        <Button label={minor == null ? tr.calc.unusable : tr.calc.use(formatMinor(minor))} disabled={minor == null} onPress={() => minor != null && onResult(minor)} />
      </View>
    </DialogShell>
  );
}

/**
 * A desktop keyboard types on the pad as its keys do, and Enter with nothing
 * pending uses the result. Read through refs, so the listener is added once
 * and never reads a stale state. Escape is left to the Modal: react-native-web
 * closes the top modal on its key-up, so closing here on key-down made the
 * panel underneath the top one, and it closed too, edits and all.
 */
function useWebKeys(state: Calc, tap: (key: CalcKey) => void, use: (() => void) | null) {
  const live = useRef({ state, tap, use });
  useLayoutEffect(() => {
    live.current = { state, tap, use };
  });
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const { state: now, tap: type, use: take } = live.current;
      // Enter answers a pending operation first, as = does; with none it uses the result.
      if (event.key === "Enter" && now.op == null) take?.();
      else {
        const key = keyFrom(event.key);
        if (!key) return;
        type(key);
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Three fixed lines — the pending operation, the number, the preview — so nothing resizes as it changes. */
function Display({ state }: { state: Calc }) {
  const { palette } = useTheme();
  const preview = previewOf(state);
  const shown = state.error ? tr.calc.error : shownOf(state);
  const previewText = preview == null ? undefined : formatNumber(preview);
  const line = { numberOfLines: 1, ellipsizeMode: "head" } as const;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={tr.calc.display(shown, previewText)}
      style={{
        marginTop: spacing.md,
        marginBottom: spacing.md,
        minHeight: calculatorPad.displayHeight,
        justifyContent: "center",
        alignItems: "flex-end",
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        backgroundColor: palette.surfaceAlt,
      }}
    >
      <Text {...line} style={[type.small, { color: palette.textSecondary }]}>
        {state.op ? `${formatNumber(state.accumulator ?? 0)} ${state.op}` : " "}
      </Text>
      <Text {...line} style={[type.amount, { color: palette.text }]}>
        {shown}
      </Text>
      <Text {...line} style={[type.small, { color: previewText ? palette.primaryText : "transparent" }]}>
        {previewText ? `= ${previewText}` : " "}
      </Text>
    </View>
  );
}

function Pad({ onKey }: { onKey: (key: CalcKey) => void }) {
  const [width, setWidth] = useState(0);
  const cell = (width - 3 * spacing.sm) / 4;
  const key = (name: CalcKey, span: { wide?: boolean; tall?: boolean } = {}) => (
    <Key
      key={name}
      name={name}
      width={span.wide ? 2 * cell + spacing.sm : cell}
      height={span.tall ? 2 * calculatorPad.keyHeight + spacing.sm : calculatorPad.keyHeight}
      onPress={() => onKey(name)}
    />
  );
  const row = (children: ReactNode) => <View style={{ flexDirection: "row", gap: spacing.sm }}>{children}</View>;
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ gap: spacing.sm }}>
      {width > 0 ? (
        <>
          {row((["C", "⌫", "÷", "×"] as const).map((name) => key(name)))}
          {row((["7", "8", "9", "-"] as const).map((name) => key(name)))}
          {row((["4", "5", "6", "+"] as const).map((name) => key(name)))}
          {row(
            <>
              <View style={{ gap: spacing.sm }}>
                {row((["1", "2", "3"] as const).map((name) => key(name)))}
                {row([key("0", { wide: true }), key(",")])}
              </View>
              {key("=", { tall: true })}
            </>,
          )}
        </>
      ) : null}
    </View>
  );
}

function Key({ name, width, height, onPress }: { name: CalcKey; width: number; height: number; onPress: () => void }) {
  const { palette, scheme } = useTheme();
  const operator = OPS.includes(name);
  const control = name === "C" || name === "⌫";
  const base = operator ? palette.primarySoft : control || scheme === "dark" ? palette.surfaceAlt : palette.surface;
  const ink = operator ? palette.primaryText : control ? palette.textSecondary : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.calc.key(name)}
      onPress={onPress}
      style={(state) => ({
        width,
        height,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        ...themeShadow.card(palette),
        ...interactionSurface(palette, state, { base }),
      })}
    >
      {name === "⌫" ? (
        <Delete accessible={false} size={iconSize.control} color={ink} strokeWidth={iconStroke.regular} />
      ) : (
        <Text style={[type.keypad, { color: ink }]}>{name}</Text>
      )}
    </Pressable>
  );
}
