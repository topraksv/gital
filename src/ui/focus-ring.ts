/**
 * The keyboard focus ring on the web, Helix's: drawn by the app rather than
 * left to the browser, whose 1 px ring was a colour from no palette here and
 * square on every rounded card. `:focus-visible` and not `:focus`, since only
 * the browser knows whether a key or a press moved focus, and a ring on every
 * tap is worse than none. The offset is negative, so the ring sits inside its
 * own box and a card that hides its overflow cannot clip it.
 *
 * The rule is in the shell, before the bundle; the colour is the live
 * palette's, which only the app knows, so it crosses as a custom property and
 * the default palette's stands in until the app sets it.
 */

export const FOCUS_PROPERTY = "--gital-focus";

// react-native-web resets `outline` on its own pressables, so each element
// focus can reach is named, which outranks that reset. Scoped to `body`, not
// `#root`: a sheet is a Modal, rendered beside `#root`, and until 2026-09-26
// no control in one had the ring.
const TARGETS = ["[tabindex]", "[role=button]", "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=tab]", "[role=slider]", "a", "input", "textarea"];

/**
 * Marks the box a control draws when its hit area is a larger, invisible
 * square around it, as an icon button's is: the ring moves from the square to
 * the box, outside its edge. `dataSet` becomes `data-focus-box` on the web and
 * nothing on a phone.
 */
export const FOCUS_BOX = { dataSet: { focusBox: "true" } } as object;

export function focusRingCss(fallback: string): string {
  const ring = `outline:2px solid var(${FOCUS_PROPERTY},${fallback})`;
  const selector = TARGETS.map((target) => `body ${target}:focus-visible`).join(",");
  // After the rule above and as specific, so they win: a hit area with a box
  // rings the box, and a sheet's title, focused for a screen reader, is no control.
  return (
    `${selector}{${ring};outline-offset:-2px;}` +
    `body :focus-visible:has(> [data-focus-box]){outline:none;}` +
    `body :focus-visible > [data-focus-box]{${ring};outline-offset:2px;}` +
    `body [role=heading]:focus-visible{outline:none;}`
  );
}
