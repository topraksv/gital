/**
 * The web offers nothing from the clipboard (SPEC 2.9): a browser asks the
 * person before a page may read it, which is no way to open an app.
 * `clipboard-link.native.ts` is the phone's.
 */

import type { ClipboardOffer } from "./clipboard-link.native";

export type { ClipboardOffer };

export async function clipboardOffer(): Promise<ClipboardOffer | null> {
  return null;
}
