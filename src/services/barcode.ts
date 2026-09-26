/**
 * A scanned barcode looked up at Open Food Facts (SPEC 2.8), the open product
 * database: no key, and Turkish products are in it by the thousand. Only the
 * code leaves the phone; `docs/BACKLOG.md` holds what PRIVACY.md will say.
 */

import type { NewPhoto } from "../data/photos";
import { NOTE_MAX } from "../domain/items";

export interface ScannedProduct {
  name: string;
  /** The first of its brands, which the item takes as its note. */
  brand: string | null;
  photo: NewPhoto | null;
}

const API = "https://world.openfoodfacts.org/api/v2/product/";
// Only the database's own picture host is fetched: the reply is data from
// anyone who edits it, and the phone must not be sent to any address in it.
const PICTURES = "https://images.openfoodfacts.org/";
const FIELDS = "product_name,product_name_tr,brands,image_front_small_url";
// A shop's aisle has poor signal; past this the person types the name.
const WAIT_MS = 8000;
// EAN-8 to GTIN-14, digits only, which is also what makes the URL safe to build.
const PRODUCT_CODE = /^\d{8,14}$/;

async function fetchFor(url: string): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), WAIT_MS);
  try {
    return await fetch(url, { signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The picture as the photo store keeps it. Open Food Facts' small front
 * picture is ~200 px, a thumbnail's size already, so one download is both.
 */
async function pictureOf(url: unknown): Promise<NewPhoto | null> {
  if (typeof url !== "string" || !url.startsWith(PICTURES)) return null;
  try {
    const response = await fetchFor(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // The bytes are checked, not the header: a JPEG begins FF D8 FF.
    if (!response.ok || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const data = `data:image/jpeg;base64,${btoa(binary)}`;
    return { data, thumb: data };
  } catch {
    // A product without its picture is still the product.
    return null;
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The product a code names, or `null` for one the database does not know.
 * Throws when it could not ask, so the person hears it was the connection.
 */
export async function lookUpBarcode(code: string): Promise<ScannedProduct | null> {
  if (!PRODUCT_CODE.test(code)) return null;
  const response = await fetchFor(`${API}${code}.json?fields=${FIELDS}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Food Facts answered ${response.status}`);
  const product = ((await response.json()) as { product?: Record<string, unknown> }).product ?? {};
  const name = text(product.product_name_tr) || text(product.product_name);
  if (!name) return null;
  const brand = text(product.brands).split(",")[0]!.trim().slice(0, NOTE_MAX) || null;
  return { name, brand, photo: await pictureOf(product.image_front_small_url) };
}
