/**
 * The wish list's rules (SPEC 7.1, 7.3, 7.6): what counts as a shop link,
 * which shop it names, which of a wish's links leads, and what the open wishes
 * come to.
 */

import { describe, expect, it } from "vitest";

import { LINK_MAX, isLinkLike, leadOf, linkFrom, openTotal, priceOf, shopOf, sortWishes, type Wish } from "../../src/domain/wishes";

describe("linkFrom", () => {
  it("keeps a web address as it was pasted, taking https when none is given", () => {
    expect(linkFrom(" https://www.trendyol.com/x/p-123?boutiqueId=6 ")).toBe("https://www.trendyol.com/x/p-123?boutiqueId=6");
    expect(linkFrom("hepsiburada.com/kahve-makinesi-p-HB1")).toBe("https://hepsiburada.com/kahve-makinesi-p-HB1");
    expect(linkFrom("http://example.com")).toBe("http://example.com/");
  });

  it("refuses what is not a web page: another scheme, a word, or one too long", () => {
    for (const typed of ["", "   ", "kahve makinesi", "javascript:alert(1)", "ftp://a.com/x", "mailto:a@b.com", "https://localhost/x", "https:///x"]) {
      expect(linkFrom(typed), typed).toBeNull();
    }
    expect(linkFrom(`https://a.com/${"x".repeat(LINK_MAX)}`)).toBeNull();
  });
});

describe("isLinkLike", () => {
  it("tells a pasted link from a wish's name, so the field knows which it was given", () => {
    expect(isLinkLike("https://ty.gl/abc")).toBe(true);
    expect(isLinkLike("www.amazon.com.tr/dp/B0")).toBe(true);
    expect(isLinkLike("Kahve makinesi")).toBe(false);
    expect(isLinkLike("süt 1.5 lt")).toBe(false);
  });
});

describe("shopOf", () => {
  it("names the shops the owner uses, and any other by its address", () => {
    expect(shopOf("https://www.trendyol.com/x")).toBe("Trendyol");
    expect(shopOf("https://ty.gl/abc")).toBe("Trendyol");
    expect(shopOf("https://www.hepsiburada.com/x")).toBe("Hepsiburada");
    expect(shopOf("https://www.amazon.com.tr/dp/B0")).toBe("Amazon");
    expect(shopOf("https://amzn.eu/d/x")).toBe("Amazon");
    expect(shopOf("https://www.n11.com/urun")).toBe("n11");
    expect(shopOf("https://shop.example.co.uk/x")).toBe("shop.example.co.uk");
  });
});

const link = (id: string, priceMinor: number | null) => ({ id, url: `https://a.com/${id}`, priceMinor });
const wish = (over: Partial<Wish>): Wish => ({
  id: "w",
  name: "Kahve makinesi",
  note: null,
  priority: 1,
  estimateMinor: null,
  boughtAt: null,
  createdAt: "2026-09-26T10:00:00.000Z",
  photoId: null,
  photo: null,
  links: [],
  ...over,
});

describe("leadOf and priceOf", () => {
  it("leads with the cheapest priced link, and with the first when none has a price", () => {
    expect(leadOf([link("a", 5000), link("b", 4000), link("c", null)])?.id).toBe("b");
    expect(leadOf([link("a", null), link("b", null)])?.id).toBe("a");
    expect(leadOf([])).toBeNull();
  });

  it("prices a wish by its cheapest link, else by the estimate", () => {
    expect(priceOf(wish({ estimateMinor: 9000, links: [link("a", 5000), link("b", 4000)] }))).toBe(4000);
    expect(priceOf(wish({ estimateMinor: 9000, links: [link("a", null)] }))).toBe(9000);
    expect(priceOf(wish({}))).toBeNull();
  });
});

describe("openTotal", () => {
  it("adds up what the wishes still open would cost, and says nothing when none has a price", () => {
    const wishes = [
      wish({ id: "1", estimateMinor: 1000 }),
      wish({ id: "2", links: [link("a", 2500)] }),
      wish({ id: "3", estimateMinor: 7000, boughtAt: "2026-09-26T11:00:00.000Z" }),
      wish({ id: "4" }),
    ];
    expect(openTotal(wishes)).toBe(3500);
    expect(openTotal([wish({})])).toBeNull();
  });
});

describe("sortWishes", () => {
  it("puts what is wanted most first and the newest before the older, and what was bought last", () => {
    const sorted = sortWishes([
      wish({ id: "old-normal", createdAt: "2026-09-01T00:00:00.000Z" }),
      wish({ id: "bought", priority: 2, boughtAt: "2026-09-20T00:00:00.000Z" }),
      wish({ id: "new-normal", createdAt: "2026-09-02T00:00:00.000Z" }),
      wish({ id: "high", priority: 2, createdAt: "2026-08-01T00:00:00.000Z" }),
      wish({ id: "low", priority: 0 }),
    ]);
    expect(sorted.map((w) => w.id)).toEqual(["high", "new-normal", "old-normal", "low", "bought"]);
  });
});
