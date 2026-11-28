/**
 * The "Fiyatlar" sheet's tabs (SPEC 7.9) over the engine's bands: which listing goes where, in what order, and
 * what the cheapest saves against the wish's own links.
 */

import { describe, expect, it } from "vitest";

import { priceView, searchProgress, SIMILAR_SHOWN, WEAK_SHOWN } from "../../src/domain/prices";
import type { ScoredOffer, SourceStatus } from "../../src/engine/engine";

type Band = ScoredOffer["match"]["band"];
let made = 0;
function scored(band: Band, netPrice: number | null, over: { score?: number; seller?: string | null; url?: string; suspicious?: boolean; shipping?: number | null; reasons?: { tone: "good" | "bad" | "info"; text: string }[] } = {}): ScoredOffer {
  made += 1;
  return {
    offer: { id: `o${made}`, sourceName: "Akakçe", seller: over.seller ?? null, title: `İlan ${made}`, url: over.url ?? `https://www.akakce.com/p/${made}` },
    match: { band, score: over.score ?? 50, reasons: over.reasons ?? [] },
    cost: over.shipping === undefined ? null : { shipping: over.shipping, price: (netPrice ?? 0) - (over.shipping ?? 0) },
    netPrice,
    suspicious: over.suspicious ?? false,
  } as unknown as ScoredOffer;
}

describe("priceView", () => {
  it("lists the same product cheapest first, a suspect last, and marks the wish's own link", () => {
    const view = priceView(
      [
        scored("same", 7222.05, { seller: "Taşdemir AVM", url: "https://www.trendyol.com/k/p-1?boutiqueId=6" }),
        scored("same", 3000, { suspicious: true }),
        scored("same", 6549, { seller: "Akakçe", shipping: 0 }),
        scored("same", null),
      ],
      [{ url: "https://www.trendyol.com/k/p-1", priceMinor: 722205 }, { url: "not a link", priceMinor: null }],
    );
    expect(view.same.map((row) => row.priceMinor)).toEqual([654900, 722205, 300000]);
    expect(view.same[0]).toMatchObject({ shop: "Akakçe", freeShipping: true, mine: false });
    expect(view.same[1]).toMatchObject({ shop: "Akakçe · Taşdemir AVM", freeShipping: false, mine: true });
    expect(view.cheapest?.priceMinor).toBe(654900);
    expect(view.savingMinor).toBe(67305);
  });

  it("adds a listing at its own price, shipping aside, and only at an address a wish can hold", () => {
    const view = priceView([scored("same", 1050, { shipping: 50, url: "https://www.vatan.com/p?utm=1" }), scored("same", 900, { url: "http://192.168.1.1/p" })], []);
    expect(view.same.map((row) => row.take)).toEqual([null, { url: "https://www.vatan.com/p?utm=1", priceMinor: 100000 }]);
  });

  it("saves nothing when a link is already cheaper, or none is priced, or nothing is the same", () => {
    expect(priceView([scored("same", 100)], [{ url: "https://a.com/x", priceMinor: 5000 }]).savingMinor).toBeNull();
    expect(priceView([scored("same", 100)], []).savingMinor).toBeNull();
    expect(priceView([scored("same", 100)], [{ url: "https://a.com/x", priceMinor: 10000 }]).savingMinor, "the same price saves nothing").toBeNull();
    expect(priceView([scored("same", 100)], [{ url: "https://a.com/x", priceMinor: 30000 }, { url: "https://a.com/y", priceMinor: 12000 }]).savingMinor, "against the cheapest link").toBe(2000);
  });

  it("never takes a listing with no address for the wish's link with none", () => {
    expect(priceView([scored("same", 100, { url: "not a link" })], [{ url: "not a link either", priceMinor: null }]).same[0]).toMatchObject({ mine: false, take: null });
    expect(priceView([scored("same", 100, { suspicious: true })], [{ url: "https://a.com/x", priceMinor: 50000 }])).toMatchObject({ cheapest: null, savingMinor: null });
  });

  it("puts near and similar listings closest first, folds the weak, counts the unrelated", () => {
    const view = priceView(
      [
        scored("similar", 9000, { score: 60, reasons: [{ tone: "good", text: "Aynı marka" }, { tone: "bad", text: "Deluxe modeli" }] }),
        scored("near", 7100, { score: 88, reasons: [{ tone: "good", text: "Aynı marka" }] }),
        ...Array.from({ length: WEAK_SHOWN + 2 }, (_, i) => scored("weak", 900, { score: 10 + i })),
        scored("unrelated", 50),
        scored("unrelated", 60),
      ],
      [],
    );
    expect(view.same).toEqual([]);
    expect(view.similar.map((row) => row.difference)).toEqual([null, "Deluxe modeli"]);
    expect(view.weak).toHaveLength(WEAK_SHOWN);
    expect(view.weak[0]!.title).toBe(`İlan ${made - 2}`);
    expect(view.hidden).toBe(2);
    expect(priceView(Array.from({ length: SIMILAR_SHOWN + 1 }, () => scored("similar", 1)), []).similar).toHaveLength(SIMILAR_SHOWN);
  });
});

describe("searchProgress", () => {
  const source = (state: SourceStatus["state"]) => ({ state }) as SourceStatus;
  it("counts the sources that answered of those asked", () => {
    expect(searchProgress([source("ok"), source("blocked"), source("running"), source("waiting"), source("disabled")], false)).toEqual({ looked: 2, asked: 4, share: 0.425 });
    expect(searchProgress([source("ok")], true).share).toBe(1);
    expect(searchProgress([], false)).toEqual({ looked: 0, asked: 0, share: 0 });
    expect(searchProgress([source("empty"), source("error")], false).looked, "found nothing, or failed, is answered too").toBe(2);
  });
});
