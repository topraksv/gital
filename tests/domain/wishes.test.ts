/**
 * The wish list's rules (SPEC 7.1, 7.3, 7.6): what counts as a shop link,
 * which shop it names, which of a wish's links leads, and what the open wishes
 * come to.
 */

import { describe, expect, it } from "vitest";

import { LINK_MAX, isUnread, leadOf, linkFrom, linkIn, openTotal, priceOf, shopOf, sortWishes, type Wish } from "../../src/domain/wishes";

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
  dueOn: null,
  links: [],
  ...over,
});

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

describe("linkIn", () => {
  it("tells a pasted link from a wish's name, so the field knows which it was given", () => {
    expect(linkIn(" https://ty.gl/abc ")).toEqual({ url: "https://ty.gl/abc", said: "" });
    expect(linkIn("www.amazon.com.tr/dp/B0")?.url).toBe("https://www.amazon.com.tr/dp/B0");
    expect(linkIn("WWW.amazon.com.tr")?.url, "a bare host is a link only when it says www").toBe("https://www.amazon.com.tr/");
    expect(linkIn("hepsiburada.com/kahve-p-HB1")).toEqual({ url: "https://hepsiburada.com/kahve-p-HB1", said: "" });
    for (const name of ["Kahve makinesi", "süt 1.5 lt", "trendyol.com", "https://localhost/x", "bak http://localhost/x"]) expect(linkIn(name), name).toBeNull();
  });

  // Trendyol's and Hepsiburada's share sheets, as they arrive on the clipboard.
  it("finds the link a shop's share text carries, and keeps what was said around it", () => {
    expect(linkIn("Şuna bir bak! Krups Kahve Makinesi https://ty.gl/abc123")).toEqual({ url: "https://ty.gl/abc123", said: "Şuna bir bak! Krups Kahve Makinesi" });
    expect(linkIn("HTTPS://app.hb.biz/x sepette")).toEqual({ url: "https://app.hb.biz/x", said: "sepette" });
  });
});

describe("isUnread", () => {
  const added = "2026-09-30T10:00:00.000Z";
  const at = (ms: number) => Date.parse(added) + ms;
  const made = (over: Partial<Wish> = {}): Wish => wish({ name: "Trendyol", createdAt: added, links: [{ id: "l", url: "https://ty.gl/abc", priceMinor: null }], ...over });

  it("is a wish with a link no phone has read, once the phone that added it has had its minute", () => {
    expect(isUnread(made(), at(60_001))).toBe(true);
    expect(isUnread(made(), at(60_000)), "still the adding phone's turn").toBe(false);
    expect(isUnread(made(), at(30 * 86_400_000)), "however long it waited").toBe(true);
    expect(isUnread(made({ name: "Krups Kahve Makinesi", photoId: "p" }), at(60_001)), "named and pictured, its price may still come").toBe(true);
    expect(isUnread(made({ links: [{ id: "k", url: "https://www.n11.com/x", priceMinor: null }, { id: "l", url: "https://ty.gl/abc", priceMinor: null }] }), at(60_001)), "any of its links").toBe(true);
    expect(isUnread(made({ links: [{ id: "k", url: "https://a.com/x", priceMinor: null, readAt: added }, { id: "l", url: "https://ty.gl/abc", priceMinor: null }] }), at(60_001)), "a link read already is not asked again").toBe(true);
  });

  it("is never one whose links were read or priced, nor one with nothing to read", () => {
    const later = at(3_600_000);
    expect(isUnread(made({ links: [{ id: "l", url: "https://ty.gl/abc", priceMinor: null, readAt: added }] }), later), "a page that gave nothing is loaded once").toBe(false);
    expect(isUnread(made({ boughtAt: added }), later)).toBe(false);
    expect(isUnread(made({ links: [{ id: "l", url: "https://ty.gl/abc", priceMinor: 100 }] }), later)).toBe(false);
    expect(isUnread(made({ links: [] }), later)).toBe(false);
    expect(isUnread(made({ links: [{ id: "k", url: "https://a.com/x", priceMinor: null }, { id: "l", url: "https://ty.gl/abc", priceMinor: null }] }), later), "every unread link is read, so every one is at a named shop").toBe(false);
    expect(isUnread(made({ name: "A.com", links: [{ id: "l", url: "https://a.com/x", priceMinor: null }] }), later), "a shop not named here is read only when its wish is saved").toBe(false);
    expect(isUnread(made({ name: "Amazon", links: [{ id: "l", url: "https://amazon.attacker.example/x", priceMinor: null }] }), later), "a look-alike of a named shop is not that shop").toBe(false);
    expect(isUnread(made({ links: [{ id: "l", url: "intent:.trendyol.com", priceMinor: null }] }), later), "an address that is not the web's is at no shop").toBe(false);
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
    expect(shopOf("Intent:.Trendyol.com"), "an address that is not the web's is at no shop").toBe("intent:.trendyol.com");
  });

  it("names a shop by its own domain only, so a co-member's look-alike host is never read unasked", () => {
    expect(shopOf("https://amazon.attacker.example/x")).toBe("amazon.attacker.example");
    expect(shopOf("https://amzn.evil.io/x")).toBe("amzn.evil.io");
    for (const host of ["trendyol.com.evil.io", "ty.gl.evil.io", "hepsiburada.com.evil.io", "n11.com.evil.io", "amazon.com.tr.evil.io"]) {
      expect(shopOf(`https://${host}/x`)).toBe(host);
    }
  });
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

  // By price: a link's price before a guess, one with neither after every
  // priced one, and what was bought still last.
  it("orders the open wishes by price either way, the unpriced after them", () => {
    const wishes = [
      // Named to sort first by id, so only the price can put it last.
      wish({ id: "a-none" }),
      wish({ id: "guess-300", estimateMinor: 300_00 }),
      wish({ id: "link-100", estimateMinor: 900_00, links: [{ id: "l", url: "https://a.com/", priceMinor: 100_00 }] }),
      wish({ id: "bought", estimateMinor: 1, boughtAt: "2026-09-20T00:00:00.000Z" }),
      wish({ id: "guess-200", estimateMinor: 200_00 }),
    ];
    expect(sortWishes(wishes, "cheapest").map((w) => w.id)).toEqual(["link-100", "guess-200", "guess-300", "a-none", "bought"]);
    expect(sortWishes(wishes, "dearest").map((w) => w.id)).toEqual(["guess-300", "guess-200", "link-100", "a-none", "bought"]);
    expect(sortWishes([...wishes].reverse(), "cheapest").map((w) => w.id)).toEqual(["link-100", "guess-200", "guess-300", "a-none", "bought"]);
  });

  it("leaves price out of the order unless it is asked for", () => {
    const wishes = [wish({ id: "b-dear", priority: 2, estimateMinor: 900_00 }), wish({ id: "a-cheap", estimateMinor: 100_00 })];
    expect(sortWishes(wishes).map((w) => w.id)).toEqual(["b-dear", "a-cheap"]);
    expect(sortWishes(wishes, "wanted").map((w) => w.id)).toEqual(["b-dear", "a-cheap"]);
  });
});
