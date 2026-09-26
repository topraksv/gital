/**
 * A person's products over the real migrations and write layer: a product
 * is starred by name, whatever list it was on, and the star comes off again
 * (SPEC 5.1); an aisle it was moved to is kept beside the star (5.4).
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex"),
}));

const { readProducts, setAisle, setStarred } = await import("../../src/data/products");
const { migratedDatabase } = await import("../helpers");

const names = async () => (await readProducts()).filter((product) => product.starred).map((product) => product.name);

beforeEach(() => {
  harness.db = migratedDatabase();
});

afterEach(() => {
  harness.db?.close();
});

describe("favourites", () => {
  it("lists what is starred, by name", async () => {
    await setStarred("Yoğurt", true);
    await setStarred("Ekmek", true);
    expect(await names()).toEqual(["Ekmek", "Yoğurt"]);
  });

  it("knows a product however its name is typed, and keeps the first spelling", async () => {
    await setStarred("Süt", true);
    await setStarred("sut", true);
    expect(await names()).toEqual(["Süt"]);
  });

  it("takes the star off, and puts it back on the same row", async () => {
    await setStarred("Süt", true);
    await setStarred("SÜT", false);
    expect(await names()).toEqual([]);
    await setStarred("süt", true);
    expect(await names()).toEqual(["Süt"]);
    expect(harness.db!.prepare("select count(*) as n from products").get()).toEqual({ n: 1 });
  });

  it("refuses a name with nothing in it", async () => {
    await expect(setStarred("  ", true)).rejects.toThrow();
  });
});

describe("moved aisles", () => {
  it("keeps where a product was put, under the star and apart from it", async () => {
    await setStarred("Süt", true);
    await setAisle("sut", "drinks");
    await setAisle("Kombucha", "drinks");
    expect(await readProducts()).toEqual([
      { name: "Kombucha", starred: false, aisle: "drinks" },
      { name: "Süt", starred: true, aisle: "drinks" },
    ]);
  });

  it("forgets the move when the product is put back where it was found", async () => {
    await setAisle("Süt", "drinks");
    await setAisle("Süt", null);
    expect(await readProducts()).toEqual([{ name: "Süt", starred: false, aisle: null }]);
  });

  it("refuses an aisle this build does not draw", async () => {
    await expect(setAisle("Süt", "garden" as never)).rejects.toThrow();
  });
});
