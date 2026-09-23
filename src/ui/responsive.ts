/**
 * Every width that changes a layout mode, named for what the width buys.
 * Ported from Helix's `src/ui/responsive.ts` one rule at a time, as a screen
 * needs it.
 */

/**
 * The one desktop threshold. A tablet in portrait is on the desktop side:
 * navigation never changes here — one bottom bar at every width.
 */
const DESKTOP_WIDTH = 768;

export function shouldUseWideGutter(viewportWidth: number): boolean {
  return viewportWidth >= DESKTOP_WIDTH;
}

/** Below this a pair of explained tiles stops fitting side by side. */
const PAIRED_TILE_WIDTH = 640;

export function shouldPairTiles(contentWidth: number): boolean {
  return contentWidth >= PAIRED_TILE_WIDTH;
}

/** A narrow browser has no room for the blur to hide much, so the veil stays denser. */
const COMPACT_NAV_MATERIAL_WIDTH = 600;

export function shouldUseCompactNavigationMaterial(viewportWidth: number): boolean {
  return viewportWidth < COMPACT_NAV_MATERIAL_WIDTH;
}

/**
 * Air a tab label keeps from its neighbours. Helix measured 6 as the boundary
 * between "tight but separate" at 360px and "one run of text" at 320px.
 */
const LABEL_BREATHING = 6;

/** A width the column provably cannot hold, for a label that wrapped. */
export function tooWide(slotWidth: number): number {
  return slotWidth + LABEL_BREATHING + 1;
}

/** Zero means "not measured yet" and reads as fits: a label must render once to be measured. */
export function tabLabelsFit(labelWidth: number, slotWidth: number): boolean {
  if (labelWidth <= 0 || slotWidth <= 0) return true;
  return labelWidth <= slotWidth - LABEL_BREATHING;
}
