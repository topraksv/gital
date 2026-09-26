/**
 * A scanned barcode looked up at Open Food Facts (SPEC 2.8): the product's
 * Turkish name first, its first brand, and its front picture brought home as
 * a JPEG the photo store takes — or nothing, for a code it does not know.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { lookUpBarcode } = await import("../../src/services/barcode");

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PICTURE = "https://images.openfoodfacts.org/images/products/869/000/000/1/front_tr.3.200.jpg";

function serve(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    const route = routes[url.split("?")[0]!];
    if (!route) throw new TypeError("Network request failed");
    return route();
  });
  return asked;
}

const product = (fields: Record<string, unknown>, status = 200) => () => new Response(JSON.stringify({ status: 1, product: fields }), { status });
const API = "https://world.openfoodfacts.org/api/v2/product/8690000000001.json";

afterEach(() => vi.unstubAllGlobals());

describe("lookUpBarcode", () => {
  it("names the product in Turkish where it can, with its first brand and its picture", async () => {
    const asked = serve({
      [API]: product({ product_name: "Milk", product_name_tr: " Süt ", brands: "Pınar, Yörsan", image_front_small_url: PICTURE }),
      [PICTURE]: () => new Response(JPEG),
    });
    const found = await lookUpBarcode("8690000000001");
    const data = `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`;
    expect(found).toEqual({ name: "Süt", brand: "Pınar", photo: { data, thumb: data } });
    expect(asked[0]).toContain("fields=");
  });

  it("takes the other name, and goes without a picture it cannot use", async () => {
    for (const picture of [
      { image_front_small_url: "https://evil.example/x.jpg" },
      { image_front_small_url: PICTURE, png: true },
      {},
    ]) {
      serve({
        [API]: product({ product_name: "Ayran", ...picture }),
        [PICTURE]: () => new Response(picture.png ? Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) : JPEG),
      });
      expect(await lookUpBarcode("8690000000001")).toEqual({ name: "Ayran", brand: null, photo: null });
    }
    serve({ [API]: product({ product_name: "Ayran", image_front_small_url: PICTURE }) });
    expect(await lookUpBarcode("8690000000001")).toMatchObject({ photo: null });
  });

  it("knows nothing of a code it has no name for, and asks nothing of what is not a product code", async () => {
    serve({ [API]: () => new Response(JSON.stringify({ status: 0 }), { status: 404 }) });
    expect(await lookUpBarcode("8690000000001")).toBeNull();
    serve({ [API]: product({ product_name: "  ", brands: "Pınar" }) });
    expect(await lookUpBarcode("8690000000001")).toBeNull();
    const asked = serve({});
    for (const code of ["", "12345", "https://a.com", "../../x"]) expect(await lookUpBarcode(code)).toBeNull();
    expect(asked).toEqual([]);
  });

  it("fails where it could not ask, so the person hears it was the connection", async () => {
    serve({});
    await expect(lookUpBarcode("8690000000001")).rejects.toThrow();
    serve({ [API]: () => new Response("", { status: 503 }) });
    await expect(lookUpBarcode("8690000000001")).rejects.toThrow();
  });
});
