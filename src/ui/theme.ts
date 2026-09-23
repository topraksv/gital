/**
 * The only file allowed to hold a literal colour, spacing step, type size or
 * duration. Everything else names one of these; `tests/theme-contract.test.ts`
 * enforces both the values and the monopoly.
 *
 * Pure data on purpose: no React Native import, so the contract test runs in
 * Node. The hook that picks a palette lives in `use-palette.ts`.
 */

export interface Palette {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  destructive: string;
  onDestructive: string;
  focus: string;
}

// Warm neutrals with one green accent. No pure black or white: both read as
// harsher than the ramp around them, and the contract test refuses them.
export const lightPalette: Palette = {
  background: "#F6F4EF",
  surface: "#FFFDF8",
  border: "#DDD8CE",
  text: "#1F1D1A",
  textMuted: "#625D54",
  primary: "#2F6B4F",
  onPrimary: "#F6F4EF",
  destructive: "#B3261E",
  onDestructive: "#FFF8F6",
  focus: "#2F6B4F",
};

export const darkPalette: Palette = {
  background: "#151412",
  surface: "#1E1C19",
  border: "#3A3631",
  text: "#EEEAE3",
  textMuted: "#A8A196",
  primary: "#86C4A0",
  onPrimary: "#10231A",
  destructive: "#F2B8B5",
  onDestructive: "#3A0B08",
  focus: "#86C4A0",
};

/** A 4-point scale. A gap two screens both need gets a name in `layout`. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  caption: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 16, lineHeight: 22 },
  title: { fontSize: 22, lineHeight: 28 },
  display: { fontSize: 30, lineHeight: 36 },
} as const;

export const radius = { sm: 6, md: 10, lg: 16 } as const;

/** Milliseconds. `docs/UI.md` "Motion" says when each may run at all. */
export const motion = { fast: 120, base: 200, slow: 320 } as const;

/** Named thresholds: a measurement with a reason, never a number typed twice. */
export const layout = {
  screenGutter: space.lg,
  // Apple HIG's minimum; Material's 48dp is met by padding, not by this.
  minTouchTarget: 44,
} as const;
