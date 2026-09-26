/**
 * A product link on the clipboard, offered for the wish list when the app
 * opens (SPEC 2.9). The two phones differ in what may be read unasked:
 *
 * - iOS asks the person each time an app reads the clipboard itself, so the
 *   app only asks whether a link is there (`hasUrlAsync`, which does not ask),
 *   and the person pastes it into the offer, which needs no asking either.
 *   With the link unseen, one offer a day is what stops a link left on the
 *   clipboard from being offered at every start.
 * - Android reads without asking, so the offer carries the link, and the same
 *   link is never offered twice.
 */

import { Platform } from "react-native";
import { getStringAsync, hasUrlAsync } from "expo-clipboard";

import { isLinkLike, linkFrom } from "../domain/wishes";
import { kv } from "./kv";

/** What to offer: the link when the phone let it be read, `null` when it is for the person to paste. */
export interface ClipboardOffer {
  url: string | null;
}

const KEYS = { url: "gital.clipboard.url", at: "gital.clipboard.at" } as const;
const DAY_MS = 86_400_000;

async function unseenIos(now: number): Promise<ClipboardOffer | null> {
  if (!(await hasUrlAsync())) return null;
  if (now - Number((await kv.get(KEYS.at)) ?? 0) < DAY_MS) return null;
  await kv.set(KEYS.at, String(now));
  return { url: null };
}

async function readAndroid(): Promise<ClipboardOffer | null> {
  const text = await getStringAsync();
  const url = isLinkLike(text) ? linkFrom(text) : null;
  if (!url || url === (await kv.get(KEYS.url))) return null;
  await kv.set(KEYS.url, url);
  return { url };
}

/** Once, as the app opens; `null` when there is nothing new to offer, or the phone would not say. */
export async function clipboardOffer(now = Date.now()): Promise<ClipboardOffer | null> {
  try {
    return Platform.OS === "ios" ? await unseenIos(now) : await readAndroid();
  } catch {
    // An offer is a courtesy: a clipboard the phone will not read is no offer, not an error.
    return null;
  }
}
