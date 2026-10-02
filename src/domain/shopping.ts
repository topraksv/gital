/**
 * Who is shopping a list (SPEC 1.6), read from ticks rather than announced:
 * a person is shopping a list while an item on it carries their tick from the
 * last quarter hour. A run ends when that lapses, when the shop is finished
 * (ticked rows leave the list) or when the tick is taken back — in each the
 * tick is gone, so nothing here remembers a run but `announce`.
 */

export const SHOPPING_WINDOW_MS = 15 * 60_000;

/** An open item's tick: who made it and when, by the ticker's device clock. */
export interface Tick {
  listId: string;
  by: string;
  at: string;
}

/** A run: the tick's own fields but its time, and the epoch ms at which it lapses if no tick follows. */
export type Shopper<T extends Tick = Tick> = Omit<T, "at"> & { expiresAt: number };

/** The people other than `me` shopping a list at `now`, one per list and person, by list then person. */
export function shoppersNow<T extends Tick>(ticks: readonly T[], me: string, now: number): Shopper<T>[] {
  const latest = new Map<string, Shopper<T>>();
  for (const { at, ...run } of ticks) {
    const time = Date.parse(at);
    if (!run.by || run.by === me || Number.isNaN(time) || now - time >= SHOPPING_WINDOW_MS) continue;
    const key = runKey(run);
    const expiresAt = time + SHOPPING_WINDOW_MS;
    if (!latest.has(key) || expiresAt > latest.get(key)!.expiresAt) latest.set(key, { ...run, expiresAt });
  }
  return [...latest.values()].sort((a, b) => a.listId.localeCompare(b.listId) || a.by.localeCompare(b.by));
}

/** When to read again: the earliest lapse, or null with nobody shopping. */
export function nextExpiry(shoppers: readonly Shopper[]): number | null {
  return shoppers.length ? Math.min(...shoppers.map((shopper) => shopper.expiresAt)) : null;
}

const runKey = (shopper: { listId: string; by: string }) => `${shopper.listId}\u0000${shopper.by}`;

/**
 * Which of the people shopping now are in a run not yet told of. The set it
 * returns is what the next call is given: a run that lapsed leaves it, so the
 * same person starting again is new.
 */
export function announce<S extends Shopper>(shoppers: readonly S[], announced: ReadonlySet<string>): { fresh: S[]; announced: Set<string> } {
  return { fresh: shoppers.filter((shopper) => !announced.has(runKey(shopper))), announced: new Set(shoppers.map(runKey)) };
}
