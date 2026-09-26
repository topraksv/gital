/**
 * A row, or a panel's part, on the web moves without motion and does not
 * swipe. Reanimated's web support runs its layout animations in JavaScript
 * without springs, and
 * pulling it and gesture-handler into the entry bundle would cost every
 * visitor the download for a cosmetic gain — Helix's reason, and the boundary
 * `keyboard-safe.tsx` draws too. A pointer ticks with the circle and deletes
 * from the item panel, the swipe's twins (`docs/UI.md` section 8).
 */
import type { ReactNode } from "react";

/** Declared here and imported by the `.native` file, so callers are checked against the real contract. */
export interface RowSwipeProps {
  children: ReactNode;
  checked: boolean;
  onTick: () => void;
  onDelete: () => void;
}

export function RowMotion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function PanelMotion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function PanelPart({ children }: { children: ReactNode; appears?: boolean }) {
  return <>{children}</>;
}

export function GestureRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function RowSwipe({ children }: RowSwipeProps) {
  return <>{children}</>;
}
