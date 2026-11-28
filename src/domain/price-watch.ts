/**
 * The price watch (SPEC 7.5): a wish's priced links are read again on the phone, and a price below the lowest
 * this phone has seen for that link rings once. What it has seen stays on the phone (`kv`), never in a synced
 * row: two phones would otherwise write the same link back and forth, and the price the owner typed is theirs.
 */

/** How often the links are read again: a check is a page per link, and prices move by the day. */
export const WATCH_EVERY_MS = 6 * 60 * 60 * 1000;

/** A fall under one per cent is a rounding or a coupon line, not news. */
const NOTICEABLE = 0.99;

/**
 * The seen prices are kept under the link id's last characters: SecureStore refuses a value past 2 KB. Not
 * the first: a uuidv7 starts with its time, so links saved in the same minute would share one key.
 */
const KEY_LENGTH = 8;

/** The most links watched, the latest added first: their seen prices must fit under that limit. */
export const WATCH_MOST = 80;

export interface WatchState {
  /** When the last check started, epoch ms. */
  at: number;
  /** Lowest price seen per link (by `keyOf`), in kuruş. */
  seen: Record<string, number>;
}

export interface WatchedLink {
  id: string;
  url: string;
  priceMinor: number;
  wishName: string;
}

export interface PriceDrop {
  wishName: string;
  url: string;
  fromMinor: number;
  toMinor: number;
}

export const keyOf = (linkId: string): string => linkId.slice(-KEY_LENGTH);

export function readWatchState(stored: string | null): WatchState {
  try {
    const parsed = JSON.parse(stored ?? "") as Partial<WatchState>;
    const seen = Object.fromEntries(Object.entries(parsed.seen ?? {}).filter((entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] > 0));
    return { at: Number.isFinite(parsed.at) ? Number(parsed.at) : 0, seen };
  } catch {
    return { at: 0, seen: {} };
  }
}

export function isWatchDue(state: WatchState, now: number): boolean {
  return now - state.at >= WATCH_EVERY_MS;
}

/**
 * The drops among the prices just read, and what is seen from now on. A link starts from the price stored on
 * it; a dearer read keeps the lowest, so a price that only comes back down does not ring twice. A link no
 * longer watched is forgotten.
 */
export function pricesRead(links: readonly WatchedLink[], read: ReadonlyMap<string, number | null>, before: WatchState, now: number): { drops: PriceDrop[]; state: WatchState } {
  const seen: Record<string, number> = {};
  const drops: PriceDrop[] = [];
  for (const link of links) {
    const key = keyOf(link.id);
    const lowest = Math.min(before.seen[key] ?? link.priceMinor, link.priceMinor);
    const price = read.get(link.id) ?? 0;
    if (price > 0 && price < lowest * NOTICEABLE) {
      drops.push({ wishName: link.wishName, url: link.url, fromMinor: lowest, toMinor: price });
      seen[key] = price;
    } else {
      seen[key] = lowest;
    }
  }
  return { drops, state: { at: now, seen } };
}
