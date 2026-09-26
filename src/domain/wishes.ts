/**
 * The wish list (`docs/SPEC.md` 7): a wish is a name, maybe a note, a
 * priority, an estimate, and links to the shops that sell it. Money is kuruş,
 * as everywhere (`money.ts`).
 */

import type { ISODate } from "./dates";

/** Low, normal, high: what the wish list sorts by first. */
export const PRIORITIES = [0, 1, 2] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Longer than any shop's product address with its tracking; a pasted page is not a link. */
export const LINK_MAX = 2048;

interface WishLink {
  id: string;
  url: string;
  priceMinor: number | null;
}

export interface Wish {
  id: string;
  name: string;
  note: string | null;
  priority: Priority;
  estimateMinor: number | null;
  boughtAt: string | null;
  createdAt: string;
  photoId: string | null;
  /** The photo's thumbnail, or `null` with none on this device (SPEC 8.2). */
  photo: string | null;
  /** The day it is wanted by (SPEC 7.1). */
  dueOn: ISODate | null;
  links: WishLink[];
}

// Parsed by hand: React Native's `URL` implements `href` and little else, so
// reading its host throws on a phone while every test passes in Node.
const WEB = /^(https?):\/\/([^/?#\s@]+)([/?#]\S*)?$/i;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?$/i;
const BARE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;

/**
 * A pasted web address as it will be opened, or `null` for anything a wish
 * must not store: no scheme but the web's, no host without a dot, nothing
 * past `LINK_MAX`. Without a scheme it is taken as https.
 */
export function linkFrom(input: string): string | null {
  const typed = input.trim();
  if (typed === "" || typed.length > LINK_MAX) return null;
  const whole = BARE.test(typed) ? `https://${typed}` : typed;
  const match = WEB.exec(whole);
  if (!match || !HOST.test(match[2]!)) return null;
  return `${match[1]!.toLowerCase()}://${match[2]!.toLowerCase()}${match[3] ?? "/"}`;
}

/** Whether the add field was given a link rather than a name. */
export function isLinkLike(input: string): boolean {
  const typed = input.trim();
  return /^(?:https?:\/\/|www\.)/i.test(typed) || (BARE.test(typed) && /[/?#]/.test(typed));
}

// The shops the owner named (SPEC 7.1), with their short-link hosts.
const SHOPS: readonly [RegExp, string][] = [
  [/(^|\.)(trendyol\.com|ty\.gl)$/, "Trendyol"],
  [/(^|\.)hepsiburada\.com$/, "Hepsiburada"],
  [/(^|\.)(amazon\.[a-z.]+|amzn\.[a-z.]+|a\.co)$/, "Amazon"],
  [/(^|\.)n11\.com$/, "n11"],
];

/** The shop a link is at: its name when it is one the owner uses, else its address's host. */
export function shopOf(url: string): string {
  const host = (WEB.exec(url)?.[2] ?? url).toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
  return SHOPS.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

/** The link a wish leads with (7.6): the cheapest with a price, else the first. */
export function leadOf<T extends { priceMinor: number | null }>(links: readonly T[]): T | null {
  const priced = links.filter((link) => link.priceMinor != null);
  if (priced.length === 0) return links[0] ?? null;
  return priced.reduce((cheapest, link) => (link.priceMinor! < cheapest.priceMinor! ? link : cheapest));
}

/** What a wish would cost: its cheapest link, else its estimate. */
export function priceOf(wish: Pick<Wish, "estimateMinor" | "links">): number | null {
  return leadOf(wish.links)?.priceMinor ?? wish.estimateMinor;
}

/** What the wishes still open come to (7.3); `null` when none of them has a price. */
export function openTotal(wishes: readonly Wish[]): number | null {
  const prices = wishes.filter((wish) => wish.boughtAt == null).map(priceOf).filter((price) => price != null);
  return prices.length === 0 ? null : prices.reduce((sum, price) => sum + price, 0);
}

/** Open before bought; the most wanted first, then the newest; bought, the latest first. */
export function sortWishes(wishes: readonly Wish[]): Wish[] {
  return [...wishes].sort(
    (a, b) =>
      Number(a.boughtAt != null) - Number(b.boughtAt != null) ||
      (b.boughtAt ?? "").localeCompare(a.boughtAt ?? "") ||
      b.priority - a.priority ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
