/**
 * Resetting the data (SPEC 9.1), Helix's, over the real write layer: each
 * part goes whole, with what hangs from it, and only it; the count shown
 * before is the count taken; and what goes leaves as tombstones, so every
 * device the account holds follows.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex"),
}));

const { addEntries, readItems, toggleChecked } = await import("../../src/data/items");
const { createList, readLists } = await import("../../src/data/lists");
const { finishShop, readShops } = await import("../../src/data/shops");
const { addWish, readCollections, readWishes, saveWish } = await import("../../src/data/wishes");
const { readProducts, setStarred } = await import("../../src/data/products");
const { createSet, readSets } = await import("../../src/data/sets");
const { readPantry } = await import("../../src/data/pantry");
const { isFrozen, readSettings, setAccountFrozen } = await import("../../src/data/settings");
const { countDataReset, resetData } = await import("../../src/data/reset");
const { migratedDatabase } = await import("../helpers");

const add = async (listId: string, ...names: string[]) => (await addEntries(listId, names.map((name) => ({ name, quantityMilli: null, unit: null })))).ids;
const live = (table: string) => Number((harness.db!.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`).get() as { n: number }).n);

/** A list with one shop behind it and one product still to buy, a collection with a linked wish, a star, a set, a pantry. */
async function household() {
  const market = await createList("Market");
  await add(market, "süt", "ekmek");
  const milk = (await readItems(market)).find((item) => item.name === "süt")!;
  await toggleChecked(milk.id);
  await finishShop(market);
  const gifts = await createList("Hediyeler", "wish");
  const wish = await addWish(gifts, "kulaklık");
  await saveWish(wish, { name: "kulaklık", note: "", priority: 0, estimateMinor: null, dueOn: null, links: [{ url: "https://example.com/k", priceMinor: null }] });
  await setStarred("elma", true);
  await createSet("Kahvaltı", [{ name: "peynir", quantityMilli: null, unit: null, note: null, urgent: false }]);
  await setAccountFrozen(false);
  return { market, gifts };
}

beforeEach(() => {
  harness.db = migratedDatabase();
});

describe("resetting the data", () => {
  it("takes the lists with everything on them and behind them, and nothing else", async () => {
    const { market } = await household();
    const before = await countDataReset(["lists"]);
    expect(before, "the list, what is still on it, the shop and what it bought").toBe(4);
    expect(await resetData(["lists"])).toBe(before);
    expect((await readLists()).map((list) => list.name)).toEqual([]);
    expect(await readItems(market)).toEqual([]);
    expect(await readShops()).toEqual([]);
    expect((await readCollections()).map((collection) => collection.name)).toEqual(["Hediyeler"]);
    expect(await readProducts()).toHaveLength(1);
    expect(await readSets()).toHaveLength(1);
    expect(await readPantry()).toHaveLength(1);
    expect(await countDataReset(["lists"]), "nothing left to take").toBe(0);
  });

  it("takes the history alone, the lists and what is still to buy kept", async () => {
    const { market } = await household();
    expect(await resetData(["history"])).toBe(2);
    expect(await readShops()).toEqual([]);
    expect((await readItems(market)).map((item) => item.name)).toEqual(["ekmek"]);
    expect((await readLists()).map((list) => list.name)).toEqual(["Market"]);
  });

  it("counts a row two parts both take once", async () => {
    await household();
    expect(await countDataReset(["lists", "history"])).toBe(4);
  });

  it("takes the wishes with their collections and links, and leaves the lists", async () => {
    const { gifts } = await household();
    expect(await resetData(["wishes"])).toBe(3);
    expect(await readCollections()).toEqual([]);
    expect(await readWishes(gifts)).toEqual([]);
    expect(live("wish_links")).toBe(0);
    expect((await readLists()).map((list) => list.name)).toEqual(["Market"]);
  });

  it("takes the products, the sets and the pantry each on its own, and never the settings", async () => {
    await household();
    expect(await resetData(["products"])).toBe(1);
    expect(await readProducts()).toEqual([]);
    expect(await resetData(["sets"])).toBe(2);
    expect(await readSets()).toEqual([]);
    expect(await resetData(["pantry"])).toBe(2);
    expect(await readPantry()).toEqual([]);
    expect(live("settings")).toBe(1);
    expect(isFrozen(await readSettings())).toBe(false);
  });

  it("sends what it took as tombstones, for the account's other devices", async () => {
    await household();
    harness.db!.exec("DELETE FROM outbox");
    const taken = await resetData(["lists", "wishes"]);
    const queued = harness.db!.prepare("SELECT payload FROM outbox").all() as { payload: string }[];
    expect(queued).toHaveLength(taken);
    expect(queued.every(({ payload }) => (JSON.parse(payload) as { deleted_at: unknown }).deleted_at != null)).toBe(true);
  });

  it("takes nothing when nothing is chosen", async () => {
    await household();
    expect(await countDataReset([])).toBe(0);
    expect(await resetData([])).toBe(0);
  });
});
