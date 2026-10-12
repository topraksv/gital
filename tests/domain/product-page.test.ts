import { describe, expect, it } from "vitest";

import { productFromPage } from "../../src/domain/product-page";

// Trendyol and Hepsiburada say it in schema.org's Product; Amazon only in its
// own markup.
const ld = (node: unknown) => `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
const TRENDYOL = `<html><head><title>Krups KM480D10 Kahve Makinesi - Fiyatı, Yorumları</title>
<meta property="og:image" content="https://cdn.dsmcdn.com/ty1659/og.jpg"></head><body>
${ld({ "@context": "https://schema.org", "@type": "WebPage" })}
${ld({ "@context": "https://schema.org", "@type": "Product", name: "Krups KM480D10 Excellence Kahve Makinesi", image: { type: "ImageObject", contentUrl: ["https://cdn.dsmcdn.com/ty1659/1_org_zoom.jpg", "https://cdn.dsmcdn.com/ty1659/2_org_zoom.jpg"] }, offers: { "@type": "Offer", priceCurrency: "TRY", price: "6749.00" } })}</body></html>`;
const HEPSIBURADA = `<title>Arzum Okka Minio Fiyatı</title>${ld({ "@type": "Product", name: "Arzum OK004 Okka Minio", image: ["https://productimages.hepsiburada.net/s/777/375/1.jpg/format:webp"], offers: { "@type": "Offer", price: "1799.05", priceCurrency: "TRY" } })}<script type="application/ld+json">[{\\"@type\\":\\"Review\\"</script>`;
const AMAZON = `<title>Philips Serisi 3300 Espresso Makinesi : Amazon.com.tr: Mutfak</title><img alt="Philips" src="https://m.media-amazon.com/images/I/61bPWkyrHHL._AC_SX300_.jpg" data-old-hires="https://m.media-amazon.com/images/I/61bPWkyrHHL._AC_SL1500_.jpg" onload="if(this.width/this.height &gt; 1.0){}" id="landingImage"><script>var d = {"priceAmount":15388.80,"currencySymbol":"TL"};</script>`;

describe("productFromPage", () => {
  it("reads a product's name, picture and price from schema.org's Product, as the big shops write it", () => {
    expect(productFromPage(TRENDYOL)).toEqual({ name: "Krups KM480D10 Excellence Kahve Makinesi", image: "https://cdn.dsmcdn.com/ty1659/1_org_zoom.jpg", priceMinor: 674_900 });
    expect(productFromPage(HEPSIBURADA)).toEqual({ name: "Arzum OK004 Okka Minio", image: "https://productimages.hepsiburada.net/s/777/375/1.jpg/format:webp", priceMinor: 179_905 });
  });

  it("falls back to Amazon's own markup, and to the page's title for a name", () => {
    expect(productFromPage(AMAZON)).toEqual({ name: "Philips Serisi 3300 Espresso Makinesi", image: "https://m.media-amazon.com/images/I/61bPWkyrHHL._AC_SL1500_.jpg", priceMinor: 1_538_880 });
  });

  it("reads Open Graph's tags where there is no Product, decoding what HTML escaped", () => {
    const page = `<meta property="og:title" content="Çay &amp; Kahve Seti"><meta content="https://shop.example/a.jpg" property="og:image"><meta property="product:price:amount" content="249,90"><meta property="product:price:currency" content="TRY">`;
    expect(productFromPage(page)).toEqual({ name: "Çay & Kahve Seti", image: "https://shop.example/a.jpg", priceMinor: 24_990 });
  });

  it("decodes every escape a tag's text carries, and takes Open Graph's price only in lira", () => {
    const page = (currency: string) =>
      productFromPage(`<meta name="og:title" content="&quot;Kupa&quot; &lt;2&gt; Anne&#39;nin &apos;seti&apos;"><meta property="og:image" content="https://a.example/1.jpg"><meta property="product:price:amount" content="10"><meta property="product:price:currency" content="${currency}">`);
    expect(page("TRY")).toEqual({ name: `"Kupa" <2> Anne'nin 'seti'`, image: "https://a.example/1.jpg", priceMinor: 1000 });
    expect(page("EUR")?.priceMinor).toBeNull();
  });

  it("finds the Product in a graph, in a list, as a group's first variant, and with a range's lowest price", () => {
    const graph = ld({ "@graph": [{ "@type": "BreadcrumbList" }, { "@type": ["Product", "Thing"], name: "A", image: "https://a.example/1.jpg", offers: [{ "@type": "AggregateOffer", lowPrice: 10, highPrice: 20, priceCurrency: "TRY" }] }] });
    expect(productFromPage(graph)).toEqual({ name: "A", image: "https://a.example/1.jpg", priceMinor: 1000 });
    const group = ld([{ "@type": "ProductGroup", name: "B", image: { url: "https://b.example/1.jpg" }, hasVariant: [{ "@type": "Product", offers: { price: 5.5, priceCurrency: "TRY" } }] }]);
    expect(productFromPage(group)).toEqual({ name: "B", image: "https://b.example/1.jpg", priceMinor: 550 });
  });

  it("keeps no price in another currency or out of range, and no picture that is not https", () => {
    const page = (offers: unknown, image = "https://a.example/1.jpg") => productFromPage(ld({ "@type": "Product", name: "A", image, offers }))!;
    expect(page({ price: "30", priceCurrency: "USD" }).priceMinor).toBeNull();
    expect(page({ price: "0", priceCurrency: "TRY" }).priceMinor).toBeNull();
    expect(page({ price: "abc", priceCurrency: "TRY" }).priceMinor).toBeNull();
    expect(page({ price: "1e20", priceCurrency: "TRY" }).priceMinor).toBeNull();
    expect(page(undefined, "http://a.example/1.jpg").image).toBeNull();
    expect(page(undefined, "javascript:alert(1)").image).toBeNull();
  });

  it("finds nothing on a page that is no product: a title alone, such as a bot wall's, is not one", () => {
    expect(productFromPage("<title>Attention Required! | Cloudflare</title>")).toBeNull();
    expect(productFromPage("")).toBeNull();
  });
});
