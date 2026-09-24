/**
 * A row on the web moves without motion. Reanimated's web support runs its
 * layout animations in JavaScript without springs, and pulling it into the
 * entry bundle would cost every visitor the download for a cosmetic gain —
 * Helix's reason, and the boundary `keyboard-safe.tsx` draws too.
 */
import type { ReactNode } from "react";

export function RowMotion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
