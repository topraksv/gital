/**
 * The pantry (SPEC 12.2, 12.8, 12.9) over the real migrations and write
 * layer: a finished shop fills it, its undo empties it again, − takes some
 * away, and finishing a product puts it back on the list it came from.
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

const { addEntries, readItems, toggleChecked } = await import("../../src/data/items");
const { finishShop, reopenShop } = await import("../../src/data/shops");
const { createList, deleteList, editList } = await import("../../src/data/lists");
const { finishPantryItem, readPantry, takeSome, undoFinish } = await import("../../src/data/pantry");
const { parseEntry } = await import("../../src/domain/items");
const { migratedDatabase } = await import("../helpers");

const T0 = new Date("2026-09-26T10:00:00.000Z");
let clock = 0;
const tick = () => vi.setSystemTime(new Date(T0.getTime() + ++clock * 1000));

let market: string;

/** Adds the entry to the list, ticks all of it, and finishes the shop. */
async function shop(listId: string, entry: string): Promise<string> {
  await addEntries(listId, parseEntry(entry));
  for (const item of await readItems(listId)) if (item.checkedAt == null) await toggleChecked(item.id);
  tick();
  const finished = await finishShop(listId);
  tick();
  return finished!.id;
}

const stock = async () => (await readPantry()).map(({ name, quantityMilli, unit }) => ({ name, quantityMilli, unit }));
const idOf = async (name: string) => (await readPantry()).find((item) => item.name === name)!.id;

beforeEach(async () => {
  harness.db = migratedDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  clock = 0;
  vi.setSystemTime(T0);
  market = await createList("Market");
});

afterEach(() => {
  vi.useRealTimers();
  harness.db?.close();
});

describe("a finished shop", () => {
  it("puts what it bought in the pantry, one piece where no quantity was given, and not what stayed on the list", async () => {
    await addEntries(market, parseEntry("2 lt süt, ekmek, peynir"));
    for (const item of await readItems(market)) if (item.name !== "Peynir") await toggleChecked(item.id);
    await finishShop(market);
    expect(await stock()).toEqual([
      { name: "Ekmek", quantityMilli: 1000, unit: "adet" },
      { name: "Süt", quantityMilli: 2000, unit: "lt" },
    ]);
  });

  it("adds to what is at home", async () => {
    await shop(market, "2 lt süt");
    await shop(market, "1 lt süt");
    expect(await stock()).toEqual([{ name: "Süt", quantityMilli: 3000, unit: "lt" }]);
  });

  it("takes it out again when undone, and finished again adds it once", async () => {
    await shop(market, "2 lt süt");
    const second = await shop(market, "1 lt süt");
    await reopenShop(second);
    expect(await stock()).toEqual([{ name: "Süt", quantityMilli: 2000, unit: "lt" }]);
    tick();
    await finishShop(market);
    expect(await stock()).toEqual([{ name: "Süt", quantityMilli: 3000, unit: "lt" }]);
  });

  it("fills nothing from a list whose pantry switch is off (SPEC 12.5)", async () => {
    const nalbur = await createList("Nalbur");
    await editList(nalbur, { name: "Nalbur", color: null, icon: null, pantry: false });
    await addEntries(nalbur, parseEntry("vida"));
    await toggleChecked((await readItems(nalbur))[0]!.id);
    expect(await finishShop(nalbur)).toMatchObject({ bought: 1, stocked: 0 });
    expect(await stock()).toEqual([]);
  });

  it("queues the pantry's rows for sync", async () => {
    await shop(market, "süt");
    const rows = harness.db!.prepare("SELECT table_name, COUNT(*) AS n FROM outbox WHERE table_name LIKE 'pantry%' GROUP BY table_name").all();
    expect(rows).toEqual([
      { table_name: "pantry_items", n: 1 },
      { table_name: "pantry_moves", n: 1 },
    ]);
  });
});

describe("takeSome", () => {
  it("takes one step away and leaves the rest", async () => {
    await shop(market, "3 süt");
    expect(await takeSome(await idOf("Süt"))).toBeNull();
    expect(await stock()).toEqual([{ name: "Süt", quantityMilli: 2000, unit: "adet" }]);
  });

  it("finishes the product when the step leaves nothing", async () => {
    await shop(market, "süt");
    const finished = await takeSome(await idOf("Süt"));
    expect(finished?.listName).toBe("Market");
    expect(await stock()).toEqual([]);
    expect(await readItems(market)).toMatchObject([{ name: "Süt", checkedAt: null }]);
  });
});

describe("finishPantryItem", () => {
  it("empties it and puts it back on the list it last came from, and the undo takes both back", async () => {
    const other = await createList("Eczane");
    await shop(market, "2 süt");
    await shop(other, "süt");
    const finished = await finishPantryItem(await idOf("Süt"));
    expect(finished.listName).toBe("Eczane");
    expect(await stock()).toEqual([]);
    expect(await readItems(other)).toMatchObject([{ name: "Süt", quantityMilli: null, checkedAt: null }]);
    expect(await readItems(market)).toEqual([]);
    tick();
    await undoFinish(finished.written);
    expect(await stock()).toEqual([{ name: "Süt", quantityMilli: 3000, unit: "adet" }]);
    expect(await readItems(other)).toEqual([]);
  });

  it("joins the product when the list has it already", async () => {
    await shop(market, "süt");
    await addEntries(market, parseEntry("2 lt süt"));
    await finishPantryItem(await idOf("Süt"));
    expect(await readItems(market)).toMatchObject([{ name: "Süt", quantityMilli: 2000, unit: "lt" }]);
  });

  it("puts it on no list when its list was deleted", async () => {
    await shop(market, "süt");
    await deleteList(market);
    const finished = await finishPantryItem(await idOf("Süt"));
    expect(finished.listName).toBeNull();
    expect(await stock()).toEqual([]);
  });

  it("refuses what is no longer at home", async () => {
    await shop(market, "süt");
    const id = await idOf("Süt");
    await finishPantryItem(id);
    await expect(finishPantryItem(id)).rejects.toThrow();
    await expect(takeSome(id)).rejects.toThrow();
  });
});
