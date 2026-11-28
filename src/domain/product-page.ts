/**
 * What a shop's product page says of its product (SPEC 7.2): its name, picture and price. The page is read in
 * the phone's WebView by gital-fiyat's product reader (`src/engine/readers.js`, `./page-reader.native.tsx`),
 * the one the extension uses; its answer comes from the page, so it is checked here as any text from it is.
 * Its own file because only the phone reads a page: kept out of `wishes.ts`, it stays out of the web build.
 */

import { isPrice } from "./money";

/** What a shop's page says of the product on it (SPEC 7.2); a price is in kuruş. */
export interface PageProduct {
  name: string | null;
  image: string | null;
  priceMinor: number | null;
}

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === "object" && value != null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

// An image is drawn only from the web's secure scheme: it is fetched on the
// phone, and nothing a page says may point it anywhere else.
const httpsOf = (value: unknown): string | null => {
  const url = text(value);
  return url && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
};

/** Lira, as kuruş, or `null` for anything not a price. */
function minorOf(value: unknown): number | null {
  if (typeof value !== "number") return null;
  const minor = Math.round(value * 100);
  return minor > 0 && isPrice(minor) ? minor : null;
}

/** The reader's product, or `null` where the page shows none (a bot wall's page reads as none). */
export function productFromPage(read: unknown): PageProduct | null {
  if (!isNode(read)) return null;
  const listing = isNode(read.listing) ? read.listing : {};
  // `name` is the page's own name for its product; the listing's title is matching's, often the shop's whole sentence.
  return { name: text(read.name) ?? text(listing.title), image: httpsOf(read.image), priceMinor: minorOf(read.price) };
}
