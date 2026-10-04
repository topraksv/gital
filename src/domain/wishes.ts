/**
 * The wish list (`docs/SPEC.md` 7): a wish is a name, maybe a note, a
 * priority, an estimate, and links to the shops that sell it. Money is kuruş,
 * as everywhere (`money.ts`).
 */

import type { ISODate } from "./dates";
import { itemNameFrom } from "./items";

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

/**
 * The link a pasted text is, or carries. A shop's share sheet hands over
 * "Şuna bak: <ad> https://ty.gl/…", which does not start as a link and so
 * became a wish with that sentence for a name and no link to read. `said` is
 * what was written around the link.
 */
export function linkIn(input: string): { url: string; said: string } | null {
  const typed = input.trim();
  // With no scheme, only the whole text can be the link; one with a scheme is found wherever it sits.
  const whole = /^www\./i.test(typed) || (BARE.test(typed) && /[/?#]/.test(typed)) ? linkFrom(typed) : null;
  if (whole) return { url: whole, said: "" };
  const carried = /https?:\/\/\S+/i.exec(typed)?.[0];
  const url = carried == null ? null : linkFrom(carried);
  return url == null ? null : { url, said: typed.replace(carried!, " ").trim() };
}

// The shops the owner named (SPEC 7.1), with their short-link hosts.
const SHOPS: readonly [RegExp, string][] = [
  [/(^|\.)(trendyol\.com|ty\.gl)$/, "Trendyol"],
  [/(^|\.)hepsiburada\.com$/, "Hepsiburada"],
  // Amazon's own domains by name: `amazon.` and any ending would take a look-alike host as the shop, and read it unasked.
  [/(^|\.)(amazon\.(com|com\.tr|de|co\.uk|fr|it|es|nl|pl|se|ca|com\.au|co\.jp|in|ae|sa|com\.be|com\.mx|com\.br|sg|eg)|amzn\.(to|eu|com|asia)|a\.co)$/, "Amazon"],
  [/(^|\.)n11\.com$/, "n11"],
];

const hostOf = (url: string) => (WEB.exec(url)?.[2] ?? url).toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
const namedShop = (url: string) => SHOPS.find(([pattern]) => pattern.test(hostOf(url)))?.[1] ?? null;

/** The shop a link is at: its name when it is one the owner uses, else its address's host. */
export function shopOf(url: string): string {
  return namedShop(url) ?? hostOf(url);
}

/** Whether a wish still carries the name its link gave it, the shop's: what a page may replace, and what says none has. */
export function isNamedByLink(name: string, url: string): boolean {
  return name === itemNameFrom(shopOf(url));
}

/**
 * When a link is read unasked: after the adding phone's minute, and for a week.
 * Nothing records that a page was tried and had no product in it, so without
 * an end a dead link would be loaded at every launch for good.
 */
const READ_GRACE_MS = 60_000;
const READ_WINDOW_MS = 7 * 86_400_000;

/**
 * A wish still as its link made it — the shop's name, no price, no photo —
 * and past the adding phone's turn: added on the web, which can read no page
 * (SPEC 7.2), or on a phone whose read failed. Only when every link is at a shop
 * named here: all of a wish's links are read, without being asked, and in a
 * shared collection they may be someone else's, who must not be able to send
 * this phone to any address.
 */
export function isUnread(wish: Wish, now: number): boolean {
  return (
    wish.boughtAt == null &&
    wish.photoId == null &&
    now - Date.parse(wish.createdAt) > READ_GRACE_MS &&
    now - Date.parse(wish.createdAt) <= READ_WINDOW_MS &&
    wish.links.every((link) => link.priceMinor == null && namedShop(link.url) != null) &&
    wish.links.some((link) => isNamedByLink(wish.name, link.url))
  );
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

export const WISH_ORDERS = ["wanted", "cheapest", "dearest"] as const;
export type WishOrder = (typeof WISH_ORDERS)[number];

/** Where a price puts an open wish: by price either way, one without any after every priced one. */
function byPrice(a: Wish, b: Wish, order: WishOrder): number {
  if (order === "wanted") return 0;
  const [left, right] = [priceOf(a), priceOf(b)];
  if (left == null || right == null) return Number(left == null) - Number(right == null);
  return order === "cheapest" ? left - right : right - left;
}

/**
 * Open before bought; by price when asked (the owner, 2026-09-27), otherwise
 * the most wanted first, then the newest; bought, the latest first.
 */
export function sortWishes(wishes: readonly Wish[], order: WishOrder = "wanted"): Wish[] {
  return [...wishes].sort(
    (a, b) =>
      Number(a.boughtAt != null) - Number(b.boughtAt != null) ||
      (b.boughtAt ?? "").localeCompare(a.boughtAt ?? "") ||
      byPrice(a, b, order) ||
      b.priority - a.priority ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
