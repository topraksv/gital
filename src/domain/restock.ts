/**
 * The restock suggestion (`docs/SPEC.md` 2.7): from a list's own history, a
 * product bought on a rhythm is offered again once the rhythm says it has run
 * out. Computed on the device from what the list's shops bought.
 */

import { foldName, type Entry, type Quantity } from "./items";

/** One product a finished shop bought, and when. */
export interface Purchase extends Quantity {
  name: string;
  boughtAt: string;
}

export interface Restock extends Entry {
  key: string;
  everyDays: number;
}

const DAY_MS = 86_400_000;

/** Two gaps are a rhythm; one is a coincidence. */
const RHYTHM_FROM = 3;

/** Two stays at home are a rhythm too (SPEC 12.7). */
const LASTED_FROM = 2;

/** Unbought for three rhythms, the habit has ended, and offering it again would nag. */
const LAPSED_AFTER = 3;

const RESTOCK_MAX = 3;

function middle(sorted: readonly number[]): number {
  const half = sorted.length / 2;
  return sorted.length % 2 === 1 ? sorted[Math.floor(half)]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

/**
 * What has run out by now, the most overdue first. `purchases` comes latest
 * first; a product's last name and quantity are what it is offered with. The
 * usual gap is the middle one, so a month away does not stretch a weekly
 * rhythm, and a day at least, so two shops in one morning do not make it
 * hourly. What the list already holds, bought or not, is not offered.
 * `lasted` is how long each product stayed at home, by folded name: measured
 * twice, it is the rhythm in place of the shop gaps (SPEC 12.7), and one
 * purchase on this list is enough to offer it with.
 */
export function restockDue(
  purchases: readonly Purchase[],
  onList: readonly { name: string }[],
  now: Date,
  lasted: ReadonlyMap<string, readonly number[]> = new Map(),
): Restock[] {
  const held = new Set(onList.map((item) => foldName(item.name)));
  const byProduct = new Map<string, Purchase[]>();
  for (const purchase of purchases) {
    const key = foldName(purchase.name);
    if (!held.has(key)) byProduct.set(key, [...(byProduct.get(key) ?? []), purchase]);
  }
  const due: (Restock & { overdue: number })[] = [];
  for (const [key, bought] of byProduct) {
    const stays = lasted.get(key) ?? [];
    const measured = stays.length >= LASTED_FROM;
    if (!measured && bought.length < RHYTHM_FROM) continue;
    const times = bought.map((purchase) => Date.parse(purchase.boughtAt));
    const gaps = measured ? [...stays] : times.slice(1).map((time, at) => times[at]! - time);
    const usual = Math.max(DAY_MS, middle(gaps.sort((a, b) => a - b)));
    const since = now.getTime() - times[0]!;
    if (since < usual || since > usual * LAPSED_AFTER) continue;
    const { name, quantityMilli, unit } = bought[0]!;
    due.push({ key, name, quantityMilli, unit, everyDays: Math.round(usual / DAY_MS), overdue: since / usual });
  }
  return due
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, RESTOCK_MAX)
    .map(({ overdue: _overdue, ...restock }) => restock);
}
