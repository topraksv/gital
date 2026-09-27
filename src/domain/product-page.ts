/**
 * What a shop's product page says of its product (SPEC 7.2): its name,
 * picture and price, read from the HTML a phone's WebView received
 * (`src/ui/page-reader.native.tsx`). Its own file because only the phone reads
 * a page: kept out of `wishes.ts`, it stays out of the web build.
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
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

// An image is drawn only from the web's secure scheme: it is fetched on the
// phone, and nothing a page says may point it anywhere else.
const httpsOf = (value: unknown): string | null => {
  const url = text(value);
  return url && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
};

function imageOf(value: unknown): string | null {
  const image = first(value);
  return isNode(image) ? httpsOf(first(image.url ?? image.contentUrl)) : httpsOf(image);
}

/** "6749.00", 6749 or a comma's "249,90": lira, as kuruş, or `null` for anything not a price. */
function minorOf(value: unknown): number | null {
  const typed = typeof value === "number" ? String(value) : text(value)?.replace(",", ".");
  if (typed == null || !/^\d+(\.\d+)?$/.test(typed)) return null;
  const minor = Math.round(Number(typed) * 100);
  return minor > 0 && isPrice(minor) ? minor : null;
}

/** An offer's price when it is in lira: a single offer's, or a range's lowest. */
function offerPrice(value: unknown): number | null {
  const offer = first(value);
  if (!isNode(offer) || offer.priceCurrency !== "TRY") return null;
  return minorOf(offer.price ?? offer.lowPrice);
}

function productsIn(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(productsIn);
  if (!isNode(value)) return [];
  const types = ([] as unknown[]).concat(value["@type"]);
  return types.includes("Product") || types.includes("ProductGroup") ? [value] : productsIn(value["@graph"]);
}

/** schema.org's Product, which every large shop writes for Google Shopping. */
function fromSchema(html: string): PageProduct | null {
  for (const [, body] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body!);
    } catch {
      continue;
    }
    const product = productsIn(parsed)[0];
    if (!product) continue;
    const variant = first(product.hasVariant);
    return {
      name: text(product.name),
      image: imageOf(product.image) ?? (isNode(variant) ? imageOf(variant.image) : null),
      priceMinor: offerPrice(product.offers) ?? (isNode(variant) ? offerPrice(variant.offers) : null),
    };
  }
  return null;
}

const decode = (value: string) =>
  value.replace(/&(amp|quot|#39|apos|lt|gt);/g, (_, entity: string) => ({ amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">" })[entity]!);

function metaOf(html: string, key: string): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!new RegExp(`(?:property|name|itemprop)=["']${key}["']`, "i").test(tag!)) continue;
    const content = /content=["']([^"']*)["']/i.exec(tag!)?.[1];
    if (content != null) return decode(content);
  }
  return null;
}

// Amazon writes neither schema.org nor Open Graph: its picture is the landing
// image's full size, its price the buy box's, said in lira.
const amazonImage = (html: string) => httpsOf(/data-old-hires="([^"]+)"/.exec(/<img\b[^>]*id="landingImage"[^>]*>/i.exec(html)?.[0] ?? "")?.[1]);
const amazonPrice = (html: string) => minorOf(/"priceAmount":(\d+(?:\.\d+)?),"currencySymbol":"TL"/.exec(html)?.[1]);

function titleOf(html: string): string | null {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  return text(title && decode(title).replace(/\s*:\s*Amazon\.[a-z.]+(:.*)?$/i, ""));
}

/**
 * The product on a shop's page, or `null` where the page shows none — a bot
 * wall's title is not a product. schema.org's Product first; then Open Graph's
 * tags; then Amazon's own markup.
 */
export function productFromPage(html: string): PageProduct | null {
  const schema = fromSchema(html);
  const image = schema?.image ?? httpsOf(metaOf(html, "og:image")) ?? amazonImage(html);
  const ogPrice = metaOf(html, "product:price:currency") === "TRY" ? minorOf(metaOf(html, "product:price:amount")) : null;
  const priceMinor = schema?.priceMinor ?? ogPrice ?? amazonPrice(html);
  if (schema == null && image == null && priceMinor == null) return null;
  return { name: schema?.name ?? text(metaOf(html, "og:title")) ?? titleOf(html), image, priceMinor };
}
