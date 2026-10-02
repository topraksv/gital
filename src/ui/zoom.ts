/**
 * The arithmetic of a zoomed photo, apart from the gesture that drives it so
 * a test can hold it. `worklet` so the viewer's gesture callbacks, which run
 * on the UI thread, can call it.
 */

export function clampScale(scale: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, scale));
}

/**
 * How far a photo drawn `shown` wide (or tall) at 1x, in a window `window`
 * across, may be dragged from the centre at `scale`: until its edge meets the
 * window's, and not at all while it still fits. A receipt is narrower than
 * the window, so the window's size let it be dragged half off the screen.
 */
export function clampPan(offset: number, shown: number, window: number, scale: number): number {
  "worklet";
  const reach = Math.max(0, shown * scale - window) / 2;
  return Math.min(reach, Math.max(-reach, offset));
}
