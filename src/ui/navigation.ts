import type { Href, ImperativeRouter } from "expo-router";

type DirtyExitFallback = (action: () => void) => boolean;

let dirtyExitFallback: DirtyExitFallback | null = null;

/**
 * Helix's: a direct link has no stack action for `usePreventRemove` to catch,
 * so the focused dirty form registers the same question for the back control.
 */
export function registerDirtyExitFallback(handler: DirtyExitFallback): () => void {
  dirtyExitFallback = handler;
  return () => {
    if (dirtyExitFallback === handler) dirtyExitFallback = null;
  };
}

/**
 * Back to where the person came from, or to the screen's parent when there is
 * nowhere to go back to: a direct link, a hand-typed URL, a stale bookmark.
 * Helix's `navigateBack`. A dirty form answers first, and its confirmed exit
 * goes back TO the parent (`dismissTo`) rather than replacing the form with it.
 */
export function navigateBack(router: ImperativeRouter, fallback: Href): void {
  if (dirtyExitFallback?.(() => router.dismissTo(fallback))) return;
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
