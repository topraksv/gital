/**
 * The primitives every screen is built from, ported from Helix's
 * `components.tsx`, `primitives.tsx`, `motion-primitives.tsx` and
 * `selection-controls.tsx` as the first screens need them. Helix keeps four
 * files because it has sixty components; Gital has a dozen.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useRouter, useScrollToTop, useSegments, type Href } from "expo-router";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import DatabaseZap from "lucide-react-native/icons/database-zap";
import type { LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { foldName, formatQuantity, type Entry } from "../domain/items";
import { initialOf, tileTone } from "../domain/names";
import { tr } from "../i18n/tr";
import { interactionSurface } from "./interaction";
import { useReducedMotion, useSpringTo } from "./motion";
import { navigateBack } from "./navigation";
import { shouldUseWideGutter } from "./responsive";
import {
  alpha,
  borderWidth,
  circle,
  contentWidth,
  controlSize,
  density,
  emptyState,
  font,
  iconSize,
  iconStroke,
  itemRow,
  listCard,
  navigationInset,
  offset,
  pressDepth,
  progressBar,
  proseLeading,
  radius,
  sectionMark,
  spacing,
  tileRadius,
  type,
  useTheme,
  type ContentWidth,
  type Palette,
} from "./theme";

// Outside a scope, everything mounts as an event.
const ScopePainted = createContext(true);

/**
 * A spring from 0 to 1 on mount, or 1 at once under reduced motion or when it
 * arrived with its `ArrivalScope`. It starts
 * where it will be drawn, so the first painted frame is already right: seeding
 * at rest and moving it in an effect showed one frame in the settled position.
 */
function useEntranceProgress(): Animated.Value {
  const reducedMotion = useReducedMotion();
  const painted = useContext(ScopePainted);
  const [progress] = useState(() => new Animated.Value(reducedMotion || !painted ? 1 : 0));
  useSpringTo(progress, 1);
  return progress;
}

/**
 * Fades in from below, so it reads as "this just happened" rather than "this
 * was always here". `distance` is one of `motion.travel`: a block arriving into
 * empty space rises, a bar or a sheet comes up from the edge it is anchored to.
 */
export function SlideUp({
  children,
  style,
  distance,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  distance: number;
}) {
  const progress = useEntranceProgress();
  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Where things arrive. An entrance mounted with the scope came with the screen
 * and is drawn at rest; one mounted after the scope painted is an event —
 * typed, ticked, restored by undo, or synced in — and plays, so a screen
 * arriving never animates as a whole (`docs/UI.md` section 7). Decided at
 * mount, so a row that moves or is merged again never remounts. The scope sits
 * above the empty state, so a first row plays too.
 */
export function ArrivalScope({ children }: { children: ReactNode }) {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <ScopePainted.Provider value={painted}>{children}</ScopePainted.Provider>;
}

/** A confirmation that lands rather than appears: a small scale pop on the entrance spring. */
export function SuccessPop({ children }: { children: ReactNode }) {
  const progress = useEntranceProgress();
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Every routed surface renders one Screen, which owns what a screen never
 * restates: the gutter, the top inset, the clearance under the floating tab
 * bar, and a centred column capped by a named width (`docs/UI.md` section 3).
 */
export function Screen({
  children,
  title,
  back,
  actions,
  width: widthName = "form",
}: {
  children?: ReactNode;
  title?: string;
  /** A pushed screen's parent, for the back control when there is no history to pop. */
  back?: Href;
  /** Controls at the title's trailing edge, centred on it. */
  actions?: ReactNode;
  width?: ContentWidth;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // A root route — a modal, sign-in — has no bar under it. Widened: typed
  // routes are generated by `expo start`, so CI types the segments differently.
  const inTabs = (useSegments() as string[])[0] === "(tabs)";
  // Pressing the tab you are on returns its screen to the top.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const gutter = shouldUseWideGutter(width) ? spacing.xxl : spacing.lg;
  const bottomPad = inTabs
    ? navigationInset({ bottomInset: insets.bottom, isWeb: Platform.OS === "web" }).bottom
    : Math.max(insets.bottom, spacing.lg) + spacing.md;
  const topPad = Math.max(insets.top, spacing.lg);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {/* Content passes under the status bar; without a band painted over it a
          row's label runs straight through the clock. */}
      {insets.top > 0 ? (
        <View
          pointerEvents="none"
          accessible={false}
          style={[styles.statusBand, { height: insets.top, backgroundColor: palette.background }]}
        />
      ) : null}
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustContentInsets={false}
        // A tap on a control while the keyboard is up lands on the first try,
        // so the quick-add field's + and a row's check need no second tap.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: topPad,
          paddingBottom: bottomPad,
          width: "100%",
          maxWidth: contentWidth[widthName],
          alignSelf: "center",
          flexGrow: 1,
        }}
      >
        {title != null || back != null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg }}>
            {back != null ? <BackButton fallback={back} /> : null}
            {/* No title yet — a pushed screen before its record has loaded —
                is no heading, or a screen reader announces an empty one. */}
            {title != null ? (
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={[type.title, { color: palette.textStrong, flex: 1, minWidth: 0 }]}
              >
                {title}
              </Text>
            ) : null}
            {actions}
          </View>
        ) : null}
        {children}
      </ScrollView>
    </View>
  );
}

/** The box every card draws, pressable or not, so the two cannot drift apart. */
export function cardEdge(palette: Palette): ViewStyle {
  return {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border + alpha.edge,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: density.list.cardPadding,
  };
}

export function Card({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ ...cardEdge(palette), backgroundColor: palette.surface, marginBottom: spacing.md, overflow: "hidden" }}>
      {children}
    </View>
  );
}

/**
 * Helix's tile with a record's first letter on one of three soft tones, until
 * the record has a picture of its own (`docs/UI.md` section 6).
 */
function LetterTile({ id, name, size }: { id: string; name: string; size: number }) {
  const { palette } = useTheme();
  const tones = [
    { fill: palette.primarySoft, ink: palette.accentText },
    { fill: palette.secondarySoft, ink: palette.secondaryText },
    { fill: palette.tertiarySoft, ink: palette.tertiaryText },
  ];
  const tone = tones[tileTone(id, tones.length)]!;
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: tileRadius(size),
        borderCurve: "continuous",
        backgroundColor: tone.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={[type.heading, { color: tone.ink }]}>{initialOf(name)}</Text>
    </View>
  );
}

/**
 * An item's tile, name and quantity, as every row that shows an item draws
 * them; `struck` is the basket's line through a ticked one. The tile's tone is
 * the product's, not the row's: history keeps its own copy of a bought item,
 * and "Süt" should wear one tone on its list and in every shop.
 */
export function ItemLabel({ item, struck = false }: { item: Entry; struck?: boolean }) {
  const { palette } = useTheme();
  const quantity = formatQuantity(item);
  return (
    <>
      <LetterTile id={foldName(item.name)} name={item.name} size={itemRow.tile} />
      <View style={{ flex: 1, minWidth: 0, gap: offset.tight }}>
        <Text
          style={[
            type.body,
            {
              fontFamily: font.medium,
              color: struck ? palette.textSecondary : palette.textStrong,
              textDecorationLine: struck ? "line-through" : "none",
            },
          ]}
        >
          {item.name}
        </Text>
        {quantity ? <Text style={[type.small, { color: palette.textSecondary }]}>{quantity}</Text> : null}
      </View>
    </>
  );
}

const checkCircle = {
  width: itemRow.check,
  height: itemRow.check,
  borderRadius: circle(itemRow.check),
  alignItems: "center",
  justifyContent: "center",
} as const;

/** The empty ring, or the filled circle and its tick popping in (`docs/UI.md` section 7, Check). */
export function CheckMark({ checked }: { checked: boolean }) {
  const { palette } = useTheme();
  return checked ? (
    <SuccessPop>
      <View style={[checkCircle, { backgroundColor: palette.secondary }]}>
        <Check accessible={false} size={iconSize.compact} color={palette.onSecondary} strokeWidth={iconStroke.mark} />
      </View>
    </SuccessPop>
  ) : (
    <View style={[checkCircle, { borderWidth: borderWidth.selected, borderColor: palette.controlBorder }]} />
  );
}

/**
 * A card that opens a screen: its tile, its name, one line under it and a
 * chevron. A list on Listeler, a finished shop on Geçmiş.
 */
export function LinkCard({
  tileId,
  title,
  detail,
  hint,
  onOpen,
}: {
  /** What the tile's tone is taken from, so a shop wears its list's tone. */
  tileId: string;
  title: string;
  detail: string;
  hint: string;
  onOpen: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.withDetail(title, detail)}
      accessibilityHint={hint}
      onPress={onOpen}
      style={(state) => ({
        ...cardEdge(palette),
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        ...interactionSurface(palette, state, { base: palette.surface }),
        transform: [{ translateY: state.pressed ? pressDepth : 0 }],
      })}
    >
      <LetterTile id={tileId} name={title} size={listCard.tile} />
      <View style={{ flex: 1, minWidth: 0, gap: offset.tight }}>
        <Text style={[type.body, { color: palette.textStrong, fontFamily: font.semibold }]}>{title}</Text>
        <Text style={[type.small, { color: palette.textSecondary }]}>{detail}</Text>
      </View>
      <ChevronRight accessible={false} size={iconSize.control} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
    </Pressable>
  );
}

/**
 * A share filling on the spring from wherever it was last drawn, never from
 * zero (`docs/UI.md` section 7). Decoration: the figure beside it is the text.
 */
export function ProgressBar({ value }: { value: number }) {
  const { palette } = useTheme();
  const [width, setWidth] = useState(0);
  const [progress] = useState(() => new Animated.Value(value));
  useSpringTo(progress, value);
  return (
    <View
      accessible={false}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ height: progressBar.height, borderRadius: circle(progressBar.height), backgroundColor: palette.surfaceAlt, overflow: "hidden" }}
    >
      {/* Slid in from the left rather than widened, so the spring runs on the
          native driver and the rounded end stays round. Hidden until measured,
          or the first frame would draw it full. */}
      <Animated.View
        style={{
          height: progressBar.height,
          borderRadius: circle(progressBar.height),
          backgroundColor: palette.secondary,
          opacity: width > 0 ? 1 : 0,
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }],
        }}
      />
    </View>
  );
}

/**
 * The app's text field: one fill, edge, padding and type for the prompt, the
 * item panel and the quick-add field. A caller's `style` places it.
 */
export function TextField({ style, ...props }: TextInputProps) {
  const { palette } = useTheme();
  return (
    <TextInput
      placeholderTextColor={palette.textSecondary}
      autoCapitalize="sentences"
      {...props}
      style={[
        {
          minHeight: controlSize.regular,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          borderRadius: radius.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + offset.tight,
          color: palette.text,
          backgroundColor: palette.surfaceAlt,
          fontFamily: font.regular,
          fontSize: type.field.fontSize,
        },
        style,
      ]}
    />
  );
}

/** A section owns both sides of itself, because it separates two groups. */
export function SectionHeader({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ marginTop: density.list.sectionGap, marginBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <View
        accessible={false}
        style={{ width: sectionMark.width, height: sectionMark.height, borderRadius: sectionMark.radius, backgroundColor: palette.primary }}
      />
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[type.sectionTitle, { color: palette.textStrong, flex: 1, minWidth: 0 }]}
      >
        {children}
      </Text>
    </View>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle> }) {
  const { palette } = useTheme();
  return (
    <Text
      style={[
        type.body,
        // Prose, and the only role given a line box — on web, where the `font`
        // shorthand would otherwise leave it at ~1.21.
        Platform.OS === "web" && { lineHeight: Math.round(type.body.fontSize * proseLeading) },
        { color: muted ? palette.textSecondary : palette.text },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * One tile, one answer. The shell will not let a caller change the box when
 * it is chosen — a thickening ring or a bolder label re-wraps the row — so
 * colour, fill and the accessible state carry the choice.
 */
export function ChoiceTile({
  label,
  description,
  selected,
  onPress,
  disabled = false,
  children,
  layout = "stack",
  minHeight,
  basis,
  surface,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  children?: ReactNode;
  /** `stack` puts the content over the label; `row` beside it. */
  layout?: "stack" | "row";
  minHeight: number;
  /** `flexBasis` for a wrapping grid; omit to share the row evenly. */
  basis?: `${number}%`;
  /** Draw in a palette the app is not wearing — the appearance card previews its choices. */
  surface?: Palette;
}) {
  const { palette } = useTheme();
  const p = surface ?? palette;
  const row = layout === "row";
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        flexGrow: 1,
        flexBasis: basis ?? 0,
        minWidth: 0,
        minHeight,
        padding: spacing.sm,
        gap: row ? spacing.md : spacing.xs,
        flexDirection: row ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        borderWidth: borderWidth.selected,
        borderColor: disabled ? p.controlBorder : selected ? p.primary : p.border + alpha.tileEdge,
        // Disabled is said in colour, never by fading: a refused control still explains itself.
        ...interactionSurface(p, state, {
          base: disabled ? p.surfaceAlt : selected ? p.primary + alpha.selectedTint : p.surface,
          enabled: !disabled,
        }),
        transform: [{ translateY: state.pressed && !disabled ? pressDepth : 0 }],
      })}
    >
      {children}
      <View style={row ? { flex: 1, minWidth: 0, justifyContent: "center" } : { minWidth: 0 }}>
        <Text
          style={[
            description ? type.body : type.small,
            {
              color: selected ? p.textStrong : p.text,
              fontFamily: font.semibold,
              textAlign: row ? "left" : "center",
              flexShrink: 1,
            },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text style={[type.small, { color: p.textSecondary, marginTop: offset.tuck, textAlign: row ? "left" : "center", flexShrink: 1 }]}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Helix's back control. A pushed screen has no native header here, so the
 * control sits in the title row; its chevron is pulled out to the gutter, or
 * the title would start a chevron's padding to the right of every other one.
 */
function BackButton({ fallback }: { fallback: Href }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.common.back}
      onPress={() => navigateBack(router, fallback)}
      style={(state) => ({
        width: controlSize.minimumTarget,
        height: controlSize.minimumTarget,
        marginLeft: -(controlSize.minimumTarget - iconSize.headerBack) / 2,
        borderRadius: radius.full,
        ...interactionSurface(palette, state),
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <ChevronLeft accessible={false} size={iconSize.headerBack} color={palette.accentText} strokeWidth={iconStroke.regular} />
    </Pressable>
  );
}

/**
 * Helix's button, in the two variants Gital draws: `primary` for the one
 * action a surface is for, `ghost` for the way out beside it.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  icon: Icon,
  size = "md",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  icon?: LucideIcon;
  size?: "md" | "sm";
}) {
  const { palette } = useTheme();
  const small = size === "sm";
  const colors = disabled
    ? { background: variant === "ghost" ? undefined : palette.surfaceAlt, foreground: palette.textSecondary }
    : variant === "primary"
      ? { background: palette.primary, foreground: palette.onPrimary }
      : { background: undefined, foreground: palette.accentText };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        ...interactionSurface(palette, state, { base: colors.background, enabled: !disabled }),
        borderRadius: radius.md,
        borderCurve: "continuous",
        paddingVertical: small ? spacing.sm : spacing.md,
        paddingHorizontal: small ? spacing.md : spacing.lg,
        // The box is the minimum target even when small: `hitSlop` does nothing on the web.
        minHeight: small ? controlSize.minimumTarget : controlSize.regular,
        flexDirection: "row",
        gap: spacing.sm,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ translateY: state.pressed && !disabled ? pressDepth : 0 }],
      })}
    >
      {Icon ? (
        <Icon accessible={false} size={small ? iconSize.compact : iconSize.control} color={colors.foreground} strokeWidth={iconStroke.regular} />
      ) : null}
      <Text style={[small ? type.buttonCompact : type.button, { color: colors.foreground, textAlign: "center", flexShrink: 1 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Helix's icon button: the pressable box is the 44-point minimum, the chip
 * painted inside it the compact one. Its label is required, because an icon
 * alone says nothing to a screen reader — and a record's control names the
 * record (`docs/UI.md` section 6).
 */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  tone = "default",
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: "default" | "danger" | "primary";
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const color = disabled
    ? palette.textMuted
    : tone === "danger" ? palette.destructive : tone === "primary" ? palette.accentText : palette.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minWidth: controlSize.minimumTarget, minHeight: controlSize.minimumTarget, alignItems: "center", justifyContent: "center" }}
    >
      {(state) => (
        <View
          style={{
            width: controlSize.compact,
            height: controlSize.compact,
            borderRadius: radius.sm,
            ...interactionSurface(palette, state, { base: tone === "primary" ? palette.primarySoft : palette.surface, enabled: !disabled }),
            alignItems: "center",
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border + alpha.controlEdge,
            transform: [{ translateY: state.pressed && !disabled ? pressDepth : 0 }],
          }}
        >
          <Icon accessible={false} size={iconSize.control} color={color} strokeWidth={iconStroke.regular} />
        </View>
      )}
    </Pressable>
  );
}

/**
 * What a screen shows while its reads keep failing. The live queries retry on
 * their own; the button retries now.
 */
export function ReadFailed({ queries }: { queries: readonly { retry: () => void }[] }) {
  return (
    <EmptyState
      icon={DatabaseZap}
      title={tr.errors.readFailedTitle}
      hint={tr.errors.readFailedHint}
      action={<Button label={tr.common.retry} onPress={() => queries.forEach((query) => query.retry())} />}
    />
  );
}

/**
 * What a screen says when it has nothing to show, and the way out of it. It
 * grows to centre itself, so on a tall window the sentence is not left against
 * the header with the page empty beneath it; on a phone it is the padded block
 * it would have been anyway. It does not animate in: it is what a page is,
 * and a page does not replay an entrance on every visit (`docs/UI.md` §7).
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexGrow: 1, justifyContent: "center", padding: spacing.xxl, alignItems: "center", gap: spacing.sm }}>
      <View
        style={{
          width: emptyState.disc,
          height: emptyState.disc,
          borderRadius: circle(emptyState.disc),
          backgroundColor: palette.surfaceAlt,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing.xs,
        }}
      >
        <Icon accessible={false} size={emptyState.icon} color={palette.textSecondary} strokeWidth={iconStroke.quiet} />
      </View>
      <Text accessibilityRole="header" aria-level={2} style={[type.heading, { color: palette.text, textAlign: "center" }]}>
        {title}
      </Text>
      <Body muted style={{ textAlign: "center" }}>
        {hint}
      </Body>
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  statusBand: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 },
});

