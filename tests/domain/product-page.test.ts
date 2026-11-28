/**
 * A wish's page as gital-fiyat's product reader answers it (SPEC 7.2): how the page is read is that reader's,
 * tested in gital-fiyat on captured pages; here, what of its answer the phone keeps.
 */

import { describe, expect, it } from "vitest";

import { productFromPage } from "../../src/domain/product-page";

const read = (over: Record<string, unknown> = {}) => ({ listing: { title: " Krups KM480D10 Excellence Kahve Makinesi " }, price: 6749, image: "https://cdn.dsmcdn.com/ty1659/1_org_zoom.jpg", ...over });

describe("productFromPage", () => {
  it("keeps the reader's name, picture and price, the price in kuruş", () => {
    expect(productFromPage(read())).toEqual({ name: "Krups KM480D10 Excellence Kahve Makinesi", image: "https://cdn.dsmcdn.com/ty1659/1_org_zoom.jpg", priceMinor: 674_900 });
    expect(productFromPage(read({ price: 1799.05 }))?.priceMinor).toBe(179_905);
  });

  it("names the wish by the page's name for its product, past the shop's title sentence", () => {
    expect(productFromPage(read({ name: " Krups KM480D10 ", listing: { title: "Krups KM480D10 Fiyatı, Yorumları - Trendyol" } }))?.name).toBe("Krups KM480D10");
    expect(productFromPage(read({ name: "  " }))?.name).toBe("Krups KM480D10 Excellence Kahve Makinesi");
  });

  it("keeps no price that is none or out of range, and no picture that is not https", () => {
    for (const price of [null, 0, -5, Number.NaN, 1e20, "6749"]) expect(productFromPage(read({ price }))?.priceMinor).toBeNull();
    for (const image of ["http://a.example/1.jpg", "javascript:alert(1)", "javascript:https://a.example/1.jpg", "https://a.example/a b.jpg", 7]) expect(productFromPage(read({ image }))?.image).toBeNull();
    expect(productFromPage(read({ listing: { title: "  " } }))?.name).toBeNull();
    expect(productFromPage(read({ listing: "x" }))?.name).toBeNull();
  });

  it("finds nothing where the reader found no product, such as a bot wall's page", () => {
    expect(productFromPage(null)).toBeNull();
    expect(productFromPage("<title>Attention Required! | Cloudflare</title>")).toBeNull();
    expect(productFromPage([read()])).toBeNull();
  });
});
