/** The drag list's arithmetic, apart from React Native so it can be tested (`src/ui/draggable-list.tsx`). */

/**
 * Where the dragged row belongs once the finger is `dy` from where it took
 * it: past half of a neighbour and the gap, it takes that neighbour's place.
 * `heights` are the rows in their present order, the dragged one at `at`, whose
 * slot has already moved `shift` from where the drag began.
 */
export function follow(heights: readonly number[], gap: number, at: number, shift: number, dy: number): { at: number; shift: number } {
  const others = heights.filter((_, index) => index !== at);
  let slot = at;
  let moved = shift;
  for (;;) {
    const below = others[slot];
    const above = others[slot - 1];
    if (below != null && dy - moved > (below + gap) / 2) {
      moved += below + gap;
      slot += 1;
    } else if (above != null && dy - moved < -(above + gap) / 2) {
      moved -= above + gap;
      slot -= 1;
    } else {
      return { at: slot, shift: moved };
    }
  }
}
