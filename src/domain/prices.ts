/**
 * A price search's results as the wish's "Fiyatlar" sheet shows them (SPEC 7.9). gital-fiyat's engine scores
 * and bands every listing (`src/engine`); this only sorts them into the sheet's tabs: "Aynı ürün" is the
 * engine's `same` band, cheapest first; "Benzerleri" its `near` and `similar`, closest first; "Az benzer" its
 * `weak`, folded; `unrelated` is only counted. Types alone come from the engine, so the web carries none of it.
 */

import type { ScoredOffer, SourceStatus } from "../engine/engine";
import { linkFrom } from "./wishes";

/** One listing, priced in kuruş as a wish's link is. */
export interface PriceRow {
  id: string;
  /** The store, or the marketplace and its seller ("Trendyol · Taşdemir AVM"). */
  shop: string;
  title: string;
  url: string;
  /** What the owner pays, shipping included: the order and the figure shown. */
  priceMinor: number;
  /**
   * What "+" adds to the wish: the address as a link is stored, and the item's own price, as the price watch
   * reads it from the page without shipping. Null when the address is not one a wish can hold.
   */
  take: { url: string; priceMinor: number } | null;
  freeShipping: boolean;
  /** Same product but far cheaper than the rest: the engine ranks it last and the sheet says why. */
  suspicious: boolean;
  /** Already one of the wish's links. */
  mine: boolean;
  /** What tells it apart from the wish, for the similar and the weak ("Deluxe modeli"). */
  difference: string | null;
}

export interface PriceView {
  same: PriceRow[];
  similar: PriceRow[];
  weak: PriceRow[];
  /** Listings of another kind of product, not shown. */
  hidden: number;
  /** The cheapest same listing that is not suspect. */
  cheapest: PriceRow | null;
  /** How much less than the wish's cheapest priced link the cheapest costs, when it does. */
  savingMinor: number | null;
}

/** The engine's caps in the extension's tabs: the closest 20 similar, 12 weak. */
export const SIMILAR_SHOWN = 20;
export const WEAK_SHOWN = 12;

const FINISHED = new Set<SourceStatus["state"]>(["ok", "empty", "blocked", "error"]);

/** How far a search has come: the sources answered of those asked, and the share for its bar. */
export function searchProgress(sources: readonly SourceStatus[], done: boolean): { looked: number; asked: number; share: number } {
  const asked = sources.filter((source) => source.state !== "disabled").length;
  const looked = sources.filter((source) => FINISHED.has(source.state)).length;
  // The sources are most of the wait; checking the best listings' own pages is the rest.
  return { looked, asked, share: done ? 1 : asked === 0 ? 0 : (looked / asked) * 0.85 };
}

/** A link's address with no query or fragment, so a shop's tracking tail does not hide that it is the same page. */
function pageOf(url: string): string | null {
  return linkFrom(url)?.replace(/[?#].*$/, "") ?? null;
}

function rowOf(scored: ScoredOffer, mine: ReadonlySet<string>): PriceRow | null {
  if (scored.netPrice == null) return null;
  const { offer, match } = scored;
  const against = match.reasons.find((reason) => reason.tone === "bad") ?? null;
  const page = pageOf(offer.url);
  const link = linkFrom(offer.url);
  return {
    id: offer.id,
    shop: offer.seller && offer.seller !== offer.sourceName ? `${offer.sourceName} · ${offer.seller}` : offer.sourceName,
    title: offer.title,
    url: offer.url,
    priceMinor: Math.round(scored.netPrice * 100),
    take: link ? { url: link, priceMinor: Math.round((scored.cost?.price ?? scored.netPrice) * 100) } : null,
    freeShipping: scored.cost?.shipping === 0,
    suspicious: scored.suspicious,
    mine: page != null && mine.has(page),
    difference: against?.text ?? null,
  };
}

export function priceView(results: readonly ScoredOffer[], links: readonly { url: string; priceMinor: number | null }[]): PriceView {
  const mine = new Set(links.map((link) => pageOf(link.url)).filter((page): page is string => page != null));
  const rows = (band: (scored: ScoredOffer) => boolean) =>
    results.filter(band).map((scored) => ({ scored, row: rowOf(scored, mine) })).filter((entry): entry is { scored: ScoredOffer; row: PriceRow } => entry.row != null);
  const byScore = (a: { scored: ScoredOffer }, b: { scored: ScoredOffer }) => b.scored.match.score - a.scored.match.score;

  const same = rows((s) => s.match.band === "same")
    .map((entry) => entry.row)
    .sort((a, b) => Number(a.suspicious) - Number(b.suspicious) || a.priceMinor - b.priceMinor);
  const similar = rows((s) => s.match.band === "near" || s.match.band === "similar").sort(byScore).slice(0, SIMILAR_SHOWN).map((entry) => entry.row);
  const weak = rows((s) => s.match.band === "weak").sort(byScore).slice(0, WEAK_SHOWN).map((entry) => entry.row);
  const cheapest = same.find((row) => !row.suspicious) ?? null;
  const linked = links.map((link) => link.priceMinor).filter((price): price is number => price != null);
  const lowest = linked.length ? Math.min(...linked) : null;
  return {
    same,
    similar,
    weak,
    hidden: results.filter((s) => s.match.band === "unrelated").length,
    cheapest,
    savingMinor: cheapest && lowest != null && cheapest.priceMinor < lowest ? lowest - cheapest.priceMinor : null,
  };
}
