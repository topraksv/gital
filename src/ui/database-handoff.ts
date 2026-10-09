/**
 * The second tab, Helix's `useDatabaseHandoff` (`src/ui/root-lifecycle.ts`).
 *
 * The web keeps the database in OPFS behind an exclusive access handle, so one
 * tab holds it and a second fails to open, and wa-sqlite stays broken for that
 * document: only a reload recovers it. So the failed tab asks, every two
 * seconds, who holds the database; the holder answers, and silence means it is
 * gone, so this tab reloads itself. Close the other tab and this one opens.
 *
 * Helix tried two lighter designs and its browser suite caught both: the
 * holder announcing its departure on `pagehide`, which fires on a same-tab
 * navigation too and handed the database away from the tab in use; and asking
 * only on `focus` or `visibilitychange`, which a background page or a lone
 * tab may never raise. The ceiling on reloads is what makes the interval safe:
 * a holder the browser has frozen cannot answer.
 */

import { useEffect, useState } from "react";
import { Platform } from "react-native";

const CHANNEL = "gital.database.holder";
/** Long enough for a live holder to answer, short enough not to keep a stale screen. */
const REPLY_GRACE_MS = 500;
const PROBE_MS = 2000;
const MAX_RELOADS = 2;
const RELOADS_KEY = "gital.database.autoreload";

function reloadsSpent(): number {
  try {
    return Number(sessionStorage.getItem(RELOADS_KEY) ?? 0) || 0;
  } catch {
    // A browser refusing session storage gets the button, not a loop.
    return MAX_RELOADS;
  }
}

function spendReload(): void {
  try {
    sessionStorage.setItem(RELOADS_KEY, String(reloadsSpent() + 1));
  } catch {
    // The read above already refuses when this would fail.
  }
}

/**
 * Answers for the database while it is open here; asks for it while opening
 * it failed. `heldElsewhere` is true once another tab answered, so the screen
 * stops offering a reload that would land on itself.
 */
export function useDatabaseHandoff(open: boolean, failed: boolean): { heldElsewhere: boolean } {
  const [heldElsewhere, setHeldElsewhere] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof BroadcastChannel === "undefined") return;
    if (!open && !failed) return;
    const channel = new BroadcastChannel(CHANNEL);
    if (open) {
      // Opened, so the ceiling is for the next wait, not spent by this one.
      try {
        sessionStorage.removeItem(RELOADS_KEY);
      } catch {
        // Nothing was spent where nothing could be stored.
      }
      channel.onmessage = (event) => {
        if (event.data === "who-has-it") channel.postMessage("i-do");
      };
      return () => channel.close();
    }

    let grace: ReturnType<typeof setTimeout> | null = null;
    const stopWaiting = () => {
      if (grace) clearTimeout(grace);
      grace = null;
    };
    channel.onmessage = (event) => {
      if (event.data !== "i-do") return;
      stopWaiting();
      setHeldElsewhere(true);
    };
    const ask = (mayReload: boolean) => {
      if (grace) return;
      channel.postMessage("who-has-it");
      // The ceiling stops the reload, never the question: knowing another tab
      // holds it matters most once reloading has been given up on.
      if (!mayReload || reloadsSpent() >= MAX_RELOADS) return;
      grace = setTimeout(() => {
        grace = null;
        spendReload();
        window.location.reload();
      }, REPLY_GRACE_MS);
    };
    // The first question only wants an answer: a holder slow to reply, a
    // throttled background tab, should not cost a reload before anything shows.
    ask(false);
    const probe = setInterval(() => ask(true), PROBE_MS);
    return () => {
      stopWaiting();
      clearInterval(probe);
      channel.close();
    };
  }, [open, failed]);

  return { heldElsewhere };
}
