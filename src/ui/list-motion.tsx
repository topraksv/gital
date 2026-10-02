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
import type { LucideIcon } from "lucide-react-native";

import { SwipeSides } from "./components";

/** What a swipe to one side does: its mark and colour while the thumb pulls, and what it runs on release. */
export interface RowAction {
  icon: LucideIcon;
  tone: "secondary" | "primary" | "destructive";
  /** What a screen reader is offered in place of the swipe. */
  label: string;
  run: () => void;
}

/** Declared here and imported by the `.native` file, so callers are checked against the real contract. A side with no action does not travel. */
export interface RowSwipeProps {
  children: ReactNode;
  right?: RowAction;
  left?: RowAction;
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

// No swipe here, but a row's sides are still offered to a screen reader.
export function RowSwipe({ children, right, left }: RowSwipeProps) {
  return <SwipeSides.Provider value={{ right, left }}>{children}</SwipeSides.Provider>;
}
