/**
 * Ready-made sets (SPEC 5.3) over the real migrations and write layer: a set
 * is made from a list's open items, read back as entries, added to a list as
 * a pasted list is, and deleted with its undo.
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

const { createSet, deleteSet, readSets, restoreSet } = await import("../../src/data/sets");
const { importEntries, readItems } = await import("../../src/data/items");
const { createList } = await import("../../src/data/lists");
const { parseEntry } = await import("../../src/domain/items");
const { migratedDatabase } = await import("../helpers");

const listed = (text: string) => parseEntry(text).map((entry) => ({ ...entry, note: null, urgent: false }));

beforeEach(() => {
  harness.db = migratedDatabase();
});

afterEach(() => {
  harness.db?.close();
});

describe("sets", () => {
  it("keeps what it was made from, and reads back by name", async () => {
    await createSet("Kahvaltı", [...listed("10 adet yumurta, peynir"), { ...listed("zeytin")[0]!, note: "Siyah" }]);
    await createSet("  Haftalık   market ", listed("süt"));
    const sets = await readSets();
    expect(sets.map((set) => set.name)).toEqual(["Haftalık market", "Kahvaltı"]);
    expect(sets[1]!.entries).toEqual([
      { name: "Yumurta", quantityMilli: 10000, unit: "adet", note: null, urgent: false },
      { name: "Peynir", quantityMilli: null, unit: null, note: null, urgent: false },
      { name: "Zeytin", quantityMilli: null, unit: null, note: "Siyah", urgent: false },
    ]);
  });

  it("holds a product once, however it was spelled", async () => {
    await createSet("Kahvaltı", listed("süt, SUT, 2 lt süt"));
    expect((await readSets())[0]!.entries.map(({ name, quantityMilli }) => [name, quantityMilli])).toEqual([["Süt", 2000]]);
  });

  it("refuses a set with no name or nothing in it", async () => {
    await expect(createSet(" ", listed("süt"))).rejects.toThrow();
    await expect(createSet("Boş", [])).rejects.toThrow();
  });

  it("goes onto a list as a pasted list does, merging what is already there", async () => {
    const market = await createList("Market");
    await importEntries(market, listed("peynir"));
    await createSet("Kahvaltı", listed("yumurta, peynir"));
    await importEntries(market, (await readSets())[0]!.entries);
    expect((await readItems(market)).map((item) => item.name).sort()).toEqual(["Peynir", "Yumurta"]);
  });

  it("is deleted, and comes back whole with the undo", async () => {
    const id = await createSet("Kahvaltı", listed("yumurta, peynir"));
    const snapshot = await deleteSet(id);
    expect(await readSets()).toEqual([]);
    await restoreSet(snapshot!);
    expect((await readSets())[0]!.entries).toHaveLength(2);
  });
});
