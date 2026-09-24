import type { Href, ImperativeRouter } from "expo-router";

/**
 * Back to where the person came from, or to the screen's parent when there is
 * nowhere to go back to: a direct link, a hand-typed URL, a stale bookmark.
 * Helix's `navigateBack`, without its unsaved-form guard, which no Gital
 * screen needs yet.
 */
export function navigateBack(router: ImperativeRouter, fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
