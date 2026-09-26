/**
 * Favourites (SPEC 5.1) over the real migrations and write layer: a product
 * is starred by name, whatever list it was on, and the star comes off again.
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

const { readFavourites, setStarred } = await import("../../src/data/products");
const { migratedDatabase } = await import("../helpers");

const names = async () => (await readFavourites()).map((favourite) => favourite.name);

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
