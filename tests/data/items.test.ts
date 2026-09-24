/**
 * A list's items over the real migrations and write layer, on Node's SQLite.
 * What it holds: an entry becomes rows, the same product is one row however
 * and by whomever it is added (SPEC 2.5), a tick moves an item to the basket
 * and back, and every edit refuses a row deleted under it.
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

const { addItems, deleteItem, readItems, restoreItem, toggleChecked, updateItem } = await import("../../src/data/items");
const { createList, deleteList, readLists } = await import("../../src/data/lists");
const { deterministicId, naturalKeys } = await import("../../src/db/ids");
const { migratedDatabase } = await import("../helpers");

function outboxCount(): number {
  return Number((harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox WHERE table_name = 'items'").get() as { n: number }).n);
}

function stored(id: string) {
  return harness.db!.prepare("SELECT * FROM items WHERE id = ?").get(id) as Record<string, unknown>;
}

const names = async (listId: string) => (await readItems(listId)).map((item) => item.name);

const T0 = new Date("2026-09-24T10:00:00.000Z");
const later = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));

let listId: string;

beforeEach(async () => {
  harness.db = migratedDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  listId = await createList("Market");
});

afterEach(() => {
  vi.useRealTimers();
  harness.db?.close();
});

describe("addItems", () => {
  it("writes each item of an entry with its quantity, and queues each row", async () => {
    const ids = await addItems(listId, "2 kg domates, 1,5 lt süt ve ekmek");
    expect(ids).toHaveLength(3);
    expect(await readItems(listId)).toEqual([
      { id: ids[0], name: "Domates", quantityMilli: 2000, unit: "kg", checkedAt: null },
      { id: ids[1], name: "Süt", quantityMilli: 1500, unit: "lt", checkedAt: null },
      { id: ids[2], name: "Ekmek", quantityMilli: null, unit: null, checkedAt: null },
    ]);
    expect(outboxCount()).toBe(3);
  });

  it("puts a new entry above what is already there, in the order it was typed", async () => {
    await addItems(listId, "süt");
    await addItems(listId, "ekmek, peynir");
    expect(await names(listId)).toEqual(["Ekmek", "Peynir", "Süt"]);
  });

  it("gives the same product on the same list the same id on every device", async () => {
    const [id] = await addItems(listId, "Süt");
    expect(id).toBe(await deterministicId(naturalKeys.openItem(listId, "sut")));
    // The key rows already on devices were made with, when it still counted shops.
    expect(id).toBe(await deterministicId(`item:${listId}:sut:0`));
  });

  it("merges the same product into one row: a quantity named again replaces the old one", async () => {
    const [first] = await addItems(listId, "2 lt süt");
    await addItems(listId, "sut");
    expect(stored(first!)).toMatchObject({ name: "Süt", quantity_milli: 2000, unit: "lt" });
    await addItems(listId, "SÜT 3");
    expect(stored(first!)).toMatchObject({ name: "Süt", quantity_milli: 3000, unit: "adet" });
    expect(await names(listId)).toEqual(["Süt"]);
  });

  it("merges a product named twice in one entry, keeping the first place and the last quantity", async () => {
    await addItems(listId, "süt, ekmek, 2 süt, süt");
    expect(await readItems(listId)).toMatchObject([
      { name: "Süt", quantityMilli: 2000, unit: "adet" },
      { name: "Ekmek" },
    ]);
  });

  it("writes nothing for a product already there with nothing new", async () => {
    await addItems(listId, "2 süt");
    const before = outboxCount();
    later(1000);
    await addItems(listId, "süt, 2 süt");
    expect(outboxCount()).toBe(before);
  });

  it("keeps a product ticked into the basket there when someone adds it again", async () => {
    const [id] = await addItems(listId, "süt");
    await toggleChecked(id!);
    await addItems(listId, "2 süt");
    expect(stored(id!)).toMatchObject({ checked_at: T0.toISOString(), quantity_milli: 2000 });
  });

  it("brings a deleted product back on top with what was typed, as one row", async () => {
    const [id] = await addItems(listId, "3 süt");
    await addItems(listId, "ekmek");
    const snapshot = await deleteItem(id!);
    await addItems(listId, "süt");
    expect(await readItems(listId)).toMatchObject([
      { id, name: "Süt", quantityMilli: null },
      { name: "Ekmek" },
    ]);
    expect(stored(id!)).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    // Undo of the old delete must not overwrite the row that came back.
    await expect(restoreItem(snapshot!)).rejects.toThrow();
  });

  it("keeps the same product on two lists apart", async () => {
    const other = await createList("Pazar");
    const [here] = await addItems(listId, "süt");
    const [there] = await addItems(other, "süt");
    expect(here).not.toBe(there);
    expect(await names(other)).toEqual(["Süt"]);
  });

  it("writes nothing when the entry names no item", async () => {
    expect(await addItems(listId, " , ve ")).toEqual([]);
    expect(outboxCount()).toBe(0);
  });

  it("refuses to add to a list deleted under the screen", async () => {
    await deleteList(listId);
    await expect(addItems(listId, "süt")).rejects.toThrow();
    expect(outboxCount()).toBe(0);
  });
});

describe("readItems", () => {
  it("lists what is left to buy first, then the basket, most recent tick first", async () => {
    const [domates, sut, ekmek] = await addItems(listId, "domates, süt, ekmek");
    await toggleChecked(domates!);
    later(1000);
    await toggleChecked(ekmek!);
    expect((await readItems(listId)).map((item) => item.id)).toEqual([sut, ekmek, domates]);
  });

  it("leaves out deleted items and other lists' items", async () => {
    const [sut] = await addItems(listId, "süt, ekmek");
    await addItems(await createList("Pazar"), "biber");
    await deleteItem(sut!);
    expect(await names(listId)).toEqual(["Ekmek"]);
  });
});

describe("toggleChecked", () => {
  it("moves an item to the basket and back to its place", async () => {
    const [domates] = await addItems(listId, "domates, süt");
    await toggleChecked(domates!);
    expect(await names(listId)).toEqual(["Süt", "Domates"]);
    await toggleChecked(domates!);
    expect(await names(listId)).toEqual(["Domates", "Süt"]);
    expect(stored(domates!)).toMatchObject({ checked_at: null });
  });

  it("reads the tick inside its write, so a second tap before the screen refreshes takes it back", async () => {
    const [id] = await addItems(listId, "süt");
    await Promise.all([toggleChecked(id!), toggleChecked(id!)]);
    expect(stored(id!)).toMatchObject({ checked_at: null });
  });

  it("refuses an item deleted under the screen", async () => {
    const [id] = await addItems(listId, "süt");
    await deleteItem(id!);
    await expect(toggleChecked(id!)).rejects.toThrow();
  });
});

describe("updateItem", () => {
  const as = (name: string, quantityMilli: number | null = null, unit: "adet" | "lt" | null = null) => ({ name, quantityMilli, unit });

  it("saves the name and the stepped quantity in place when the product stays the same", async () => {
    const [id] = await addItems(listId, "sut");
    later(1000);
    await updateItem(id!, as(" süt ", 2000, "adet"));
    expect(await readItems(listId)).toMatchObject([{ id, name: "Süt", quantityMilli: 2000, unit: "adet" }]);
    expect(outboxCount()).toBe(2);
  });

  it("moves a renamed item to its new product's id, carrying what it held", async () => {
    const [sut] = await addItems(listId, "2 lt süt, ekmek");
    await toggleChecked(sut!);
    await updateItem(sut!, as("Ayran", 2000, "lt"));
    const ayran = await deterministicId(naturalKeys.openItem(listId, "ayran"));
    expect(await readItems(listId)).toMatchObject([
      { name: "Ekmek" },
      { id: ayran, name: "Ayran", quantityMilli: 2000, unit: "lt", checkedAt: T0.toISOString() },
    ]);
    expect(stored(sut!).deleted_at).not.toBeNull();
    // Adding "süt" now makes a new row rather than renaming Ayran back.
    await addItems(listId, "süt");
    expect(await names(listId)).toEqual(["Süt", "Ekmek", "Ayran"]);
  });

  it("merges into the product it is renamed to as adding it again would: that row's place and tick stay", async () => {
    const [sut, ayran] = await addItems(listId, "süt, 3 ayran, ekmek");
    await toggleChecked(ayran!);
    await updateItem(sut!, as("ayran"));
    expect(await readItems(listId)).toEqual([
      { id: expect.any(String), name: "Ekmek", quantityMilli: null, unit: null, checkedAt: null },
      { id: ayran, name: "Ayran", quantityMilli: 3000, unit: "adet", checkedAt: T0.toISOString() },
    ]);
    expect(stored(sut!).deleted_at).not.toBeNull();
  });

  it("merges into the product it is renamed to, when that is already on the list", async () => {
    const [sut, ayran] = await addItems(listId, "2 süt, ayran");
    await updateItem(sut!, as("ayran", 2000, "adet"));
    expect(await readItems(listId)).toMatchObject([{ id: ayran, name: "Ayran", quantityMilli: 2000 }]);
  });

  it("writes nothing when nothing has changed", async () => {
    const [id] = await addItems(listId, "süt");
    const before = outboxCount();
    await updateItem(id!, as("Süt"));
    expect(outboxCount()).toBe(before);
  });

  it("refuses to tick or edit an item whose list was deleted under the screen", async () => {
    const [id] = await addItems(listId, "süt");
    await deleteList(listId);
    await expect(toggleChecked(id!)).rejects.toThrow();
    await expect(updateItem(id!, as("Ayran"))).rejects.toThrow();
    expect(await readItems(listId)).toEqual([expect.objectContaining({ id, checkedAt: null })]);
  });

  it("refuses an empty name, and an item deleted under the screen", async () => {
    const [id] = await addItems(listId, "süt");
    await expect(updateItem(id!, as("  "))).rejects.toThrow();
    await deleteItem(id!);
    await expect(updateItem(id!, as("Ayran"))).rejects.toThrow();
  });
});

describe("deleteItem and restoreItem", () => {
  it("tombstones the item and restores it where it was", async () => {
    const [sut] = await addItems(listId, "süt, ekmek");
    const snapshot = await deleteItem(sut!);
    expect(await names(listId)).toEqual(["Ekmek"]);
    await restoreItem(snapshot!);
    expect(await names(listId)).toEqual(["Süt", "Ekmek"]);
  });
});

describe("readLists counts", () => {
  it("says how many items each list has and how many are still to buy", async () => {
    const [sut] = await addItems(listId, "süt, ekmek, peynir");
    await toggleChecked(sut!);
    const [deleted] = await addItems(listId, "biber");
    await deleteItem(deleted!);
    await createList("Pazar");
    expect(await readLists()).toMatchObject([
      { name: "Market", total: 3, inBasket: 1 },
      { name: "Pazar", total: 0, inBasket: 0 },
    ]);
  });
});
