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

const { addEntries, deleteItem, importEntries, readItems, readKnownProducts, readShopItems, restoreItem, toggleChecked, undoSave, updateItem } = await import("../../src/data/items");
const { NOTE_MAX, parseEntry, parseList } = await import("../../src/domain/items");
type ItemChange = import("../../src/domain/items").ItemChange;
/** The quick-add field's Enter. */
const addItems = (list: string, text: string) => addEntries(list, parseEntry(text));
const { finishShop, readShops } = await import("../../src/data/shops");
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
      { id: ids[0], name: "Domates", quantityMilli: 2000, unit: "kg", checkedAt: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null },
      { id: ids[1], name: "Süt", quantityMilli: 1500, unit: "lt", checkedAt: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null },
      { id: ids[2], name: "Ekmek", quantityMilli: null, unit: null, checkedAt: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null },
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

const as = (name: string, quantityMilli: number | null = null, unit: "adet" | "lt" | null = null) => ({ name, quantityMilli, unit, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null });

describe("updateItem", () => {

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
      { id: expect.any(String), name: "Ekmek", quantityMilli: null, unit: null, checkedAt: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null },
      { id: ayran, name: "Ayran", quantityMilli: 3000, unit: "adet", checkedAt: T0.toISOString(), note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null },
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
    // A later stamp, or the outbox key would repeat and hide a second write.
    later(1000);
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

describe("a note and urgency", () => {
  const change = (name: string, note: string | null, urgent: boolean) => ({ ...as(name), note, urgent });

  it("saves a note folded and cut, a blank one as none, and puts an urgent item above the rest until it is ticked", async () => {
    const [sut, ekmek, peynir] = await addItems(listId, "süt, ekmek, peynir");
    await updateItem(peynir!, change("Peynir", "  Pınar   olsun ", true));
    expect(await readItems(listId)).toMatchObject([
      { id: peynir, note: "Pınar olsun", urgent: true },
      { id: sut, note: null, urgent: false },
      { id: ekmek },
    ]);
    // Saved again unchanged, it is not an edit: the stored 1 is the panel's true.
    const before = outboxCount();
    later(1000);
    await updateItem(peynir!, change("Peynir", "Pınar olsun", true));
    expect(outboxCount()).toBe(before);
    await toggleChecked(peynir!);
    expect((await readItems(listId)).map((item) => item.id)).toEqual([sut, ekmek, peynir]);
    await updateItem(ekmek!, change("Ekmek", "x".repeat(NOTE_MAX + 20), false));
    await updateItem(sut!, change("Süt", "   ", false));
    expect((await readItems(listId)).map((item) => item.note?.length ?? null)).toEqual([null, NOTE_MAX, 11]);
  });

  it("brings a product added again, after it was deleted or bought, back without either", async () => {
    const [sut, ekmek] = await addItems(listId, "süt, ekmek");
    await updateItem(sut!, change("Süt", "Pınar olsun", true));
    await updateItem(ekmek!, change("Ekmek", "Tam buğday", true));
    await deleteItem(ekmek!);
    await toggleChecked(sut!);
    const shop = await finishShop(listId);
    await addItems(listId, "süt, ekmek");
    expect(await readItems(listId)).toMatchObject([
      { id: sut, note: null, urgent: false },
      { id: ekmek, note: null, urgent: false },
    ]);
    // What was bought keeps both: the row shows urgency only while it is still to buy.
    expect(await readShopItems(shop!.id)).toMatchObject([{ name: "Süt", note: "Pınar olsun", urgent: true }]);
  });

  it("gives the product an item is renamed onto the note and urgency the panel saved", async () => {
    const [sut, ayran] = await addItems(listId, "süt, ayran");
    await updateItem(sut!, change("ayran", "Sütaş", true));
    expect(await readItems(listId)).toMatchObject([{ id: ayran, note: "Sütaş", urgent: true }]);
  });
});

describe("not found, and bought instead", () => {
  it("keeps an item not found on the list, below what is still to find, until it is ticked", async () => {
    const [sut, ekmek, peynir] = await addItems(listId, "süt, ekmek, peynir");
    await updateItem(sut!, { ...as("Süt"), urgent: true, notFound: true });
    await updateItem(peynir!, { ...as("Peynir"), urgent: true });
    expect(await readItems(listId)).toMatchObject([
      { id: peynir, notFound: false },
      { id: ekmek, notFound: false },
      { id: sut, notFound: true, checkedAt: null },
    ]);
    await toggleChecked(sut!);
    expect(await readItems(listId)).toMatchObject([{ id: peynir }, { id: ekmek }, { id: sut, notFound: false, checkedAt: T0.toISOString() }]);
    // Not found cannot be saved onto what is in the basket, by any path.
    await updateItem(sut!, { ...as("Süt"), notFound: true });
    await addItems(listId, "ayran");
    await updateItem(ekmek!, { ...as("Ekmek"), notFound: true });
    later(1000);
    await toggleChecked(ekmek!);
    await updateItem(peynir!, { ...as("ekmek"), notFound: true });
    expect((await readItems(listId)).map(({ name, notFound }) => [name, notFound])).toEqual([["Ayran", false], ["Ekmek", false], ["Süt", false]]);
  });

  it("puts what was bought instead in the basket, keeps it in history, and forgets it when the tick is taken back", async () => {
    const [sut] = await addItems(listId, "süt");
    await updateItem(sut!, { ...as("Süt"), notFound: true, boughtInstead: "  sütaş " });
    expect(await readItems(listId)).toMatchObject([{ id: sut, notFound: false, boughtInstead: "Sütaş", checkedAt: T0.toISOString() }]);
    await toggleChecked(sut!);
    expect(await readItems(listId)).toMatchObject([{ id: sut, boughtInstead: null, checkedAt: null }]);
    await updateItem(sut!, { ...as("Süt"), boughtInstead: "Sütaş" });
    const shop = await finishShop(listId);
    expect(await readShopItems(shop!.id)).toMatchObject([{ name: "Süt", boughtInstead: "Sütaş" }]);
    await addItems(listId, "süt");
    expect(await readItems(listId)).toMatchObject([{ id: sut, boughtInstead: null, checkedAt: null }]);
    // Renamed onto a product already on the list, that product was what was bought around.
    const [ayran] = await addItems(listId, "ayran");
    await updateItem(sut!, { ...as("ayran"), boughtInstead: "Kefir" });
    expect(await readItems(listId)).toMatchObject([{ id: ayran, name: "Ayran", boughtInstead: "Kefir", checkedAt: expect.any(String) }]);
  });
});

describe("a price", () => {
  it("is what was paid: saving one puts the item in the basket, and taking the tick back forgets it", async () => {
    const [sut, ekmek] = await addItems(listId, "süt, ekmek");
    await toggleChecked(ekmek!);
    await updateItem(ekmek!, { ...as("Ekmek"), priceMinor: 1250 });
    await updateItem(sut!, { ...as("Süt"), priceMinor: 4590 });
    expect(await readItems(listId)).toMatchObject([
      { id: sut, priceMinor: 4590, checkedAt: T0.toISOString() },
      { id: ekmek, priceMinor: 1250, checkedAt: T0.toISOString() },
    ]);
    await toggleChecked(sut!);
    expect(stored(sut!)).toMatchObject({ price_minor: null, checked_at: null });
  });

  it("stays with the product added again while it is in the basket, and not after it was bought", async () => {
    const [sut] = await addItems(listId, "süt");
    await updateItem(sut!, { ...as("Süt"), priceMinor: 4590 });
    await addItems(listId, "2 lt süt");
    expect(await readItems(listId)).toMatchObject([{ id: sut, quantityMilli: 2000, priceMinor: 4590 }]);
    await finishShop(listId);
    await addItems(listId, "süt");
    expect(await readItems(listId)).toMatchObject([{ id: sut, priceMinor: null, checkedAt: null }]);
  });

  it("goes into history with the item, and a shop's total is the sum of what was priced", async () => {
    const [sut, ekmek, peynir] = await addItems(listId, "süt, ekmek, peynir");
    await updateItem(sut!, { ...as("Süt"), priceMinor: 4590 });
    await updateItem(ekmek!, { ...as("Ekmek"), priceMinor: 1250 });
    await toggleChecked(peynir!);
    const priced = await finishShop(listId);
    expect(await readShopItems(priced!.id)).toMatchObject([
      { name: "Süt", priceMinor: 4590 },
      { name: "Ekmek", priceMinor: 1250 },
      { name: "Peynir", priceMinor: null },
    ]);
    later(1000);
    await addItems(listId, "ayran");
    await toggleChecked((await readItems(listId))[0]!.id);
    await finishShop(listId);
    expect((await readShops()).map(({ bought, spentMinor }) => [bought, spentMinor])).toEqual([[1, null], [3, 5840]]);
  });

  it("stays with this list's shop when the item goes to another list, and with the copy left here", async () => {
    const other = await createList("Pazar");
    const [sut, ekmek] = await addItems(listId, "süt, ekmek");
    await updateItem(sut!, { ...as("Süt"), priceMinor: 4590 }, { listId: other, keep: true });
    await updateItem(ekmek!, { ...as("Ekmek"), priceMinor: 1250 }, { listId: other, keep: false });
    expect(await readItems(listId)).toMatchObject([{ id: sut, priceMinor: 4590 }]);
    expect(await readItems(other)).toMatchObject([
      { name: "Ekmek", priceMinor: null, checkedAt: null },
      { name: "Süt", priceMinor: null, checkedAt: null },
    ]);
  });

  it("refuses a price that is not whole, non-negative kuruş", async () => {
    const [sut] = await addItems(listId, "süt");
    for (const priceMinor of [-1, 12.5, Number.NaN, 100_000_000_000_000]) {
      await expect(updateItem(sut!, { ...as("Süt"), priceMinor }), String(priceMinor)).rejects.toThrow();
    }
    expect(stored(sut!)).toMatchObject({ price_minor: null, checked_at: null });
  });
});

describe("a save that sends an item to another list, and its undo", () => {
  const send = (id: string, change: ItemChange, to: string, keep = false) => updateItem(id, change, { listId: to, keep });

  it("sends what the item needs to the top of the other list, to buy, and undo takes the whole save back", async () => {
    const eczane = await createList("Eczane");
    await addItems(eczane, "vitamin");
    const [sut] = await addItems(listId, "süt, ekmek");
    await toggleChecked(sut!);
    const market = await readItems(listId);
    later(1000);
    const saved = await send(sut!, { ...as("Süt", 2000, "lt"), note: "Pınar", boughtInstead: "Sütaş" }, eczane);
    expect(saved.name).toBe("Süt");
    expect(await names(listId)).toEqual(["Ekmek"]);
    // The tick and the substitute were this list's shop, and stay with it.
    expect(await readItems(eczane)).toMatchObject([
      { name: "Süt", quantityMilli: 2000, unit: "lt", note: "Pınar", notFound: false, boughtInstead: null, checkedAt: null },
      { name: "Vitamin" },
    ]);
    await undoSave(saved.written, listId);
    expect(await readItems(listId)).toEqual(market);
    expect(await names(eczane)).toEqual(["Vitamin"]);
  });

  it("with keep, saves the item here and merges a copy into the product on the other list; undo takes back both", async () => {
    const eczane = await createList("Eczane");
    const [there] = await addItems(eczane, "süt");
    await toggleChecked(there!);
    const [sut] = await addItems(listId, "süt");
    const before = [await readItems(listId), await readItems(eczane)];
    later(1000);
    const saved = await send(sut!, { ...as("Süt", 2000, "lt"), urgent: true }, eczane, true);
    expect(await readItems(listId)).toMatchObject([{ id: sut, quantityMilli: 2000, urgent: true }]);
    // That product's row keeps its name, place and tick, and takes what the item has.
    expect(await readItems(eczane)).toMatchObject([{ id: there, quantityMilli: 2000, urgent: true, checkedAt: T0.toISOString() }]);
    await undoSave(saved.written, listId);
    expect([await readItems(listId), await readItems(eczane)]).toEqual(before);
  });

  it("sends the item that was opened, and leaves the product it was renamed to here", async () => {
    const eczane = await createList("Eczane");
    const [sut, ekmek] = await addItems(listId, "süt, ekmek");
    await toggleChecked(ekmek!);
    await send(sut!, as("ekmek"), eczane);
    expect(await readItems(listId)).toMatchObject([{ id: ekmek, checkedAt: T0.toISOString() }]);
    expect(await readItems(eczane)).toMatchObject([{ name: "Ekmek", checkedAt: null }]);
  });

  it("refuses an undo over a change made since, or under a list that is gone, and a send to its own list or a deleted one", async () => {
    const eczane = await createList("Eczane");
    const [old] = await addItems(eczane, "süt");
    await updateItem(old!, { ...as("Süt"), note: "eski" });
    await deleteItem(old!);
    const [sut] = await addItems(listId, "süt");
    const saved = await send(sut!, as("Süt"), eczane);
    expect(await readItems(eczane)).toMatchObject([{ id: old, note: null }]);
    later(1000);
    await toggleChecked(old!);
    await expect(undoSave(saved.written, listId)).rejects.toThrow();
    // Taken back out of the basket, the row is as the save wrote it again.
    await toggleChecked(old!);
    await undoSave(saved.written, listId);
    expect(await names(eczane)).toEqual([]);
    expect(stored(old!)).toMatchObject({ note: "eski", deleted_at: expect.any(String) });
    expect(await names(listId)).toEqual(["Süt"]);
    const pazar = await createList("Pazar");
    await deleteList(pazar);
    await expect(send(sut!, as("Süt"), pazar)).rejects.toThrow();
    await expect(send(sut!, as("Süt"), listId, true)).rejects.toThrow();
    const again = await send(sut!, as("Süt"), eczane);
    await deleteList(listId);
    await expect(undoSave(again.written, listId)).rejects.toThrow();
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

describe("readKnownProducts", () => {
  it("knows each product once, spelled as last written, latest first, counting each time it was bought", async () => {
    const [sut] = await addItems(listId, "süt, ekmek, peynir");
    await toggleChecked(sut!);
    later(1000);
    await finishShop(listId);
    later(2000);
    await addItems(listId, "SÜT");
    const peynir = (await readItems(listId)).find((item) => item.name === "Peynir")!;
    await deleteItem(peynir.id);
    const other = await createList("Pazar");
    await addItems(other, "domates");
    await deleteList(other);
    expect(await readKnownProducts()).toEqual([
      { key: "sut", name: "SÜT", times: 2 },
      { key: "ekmek", name: "Ekmek", times: 1 },
    ]);
  });
});

describe("a pasted list, and its undo", () => {
  it("lands each item with its note and urgency, merges a product named twice or already here, and undo takes the paste back", async () => {
    const [sut] = await addItems(listId, "süt");
    await toggleChecked(sut!);
    const before = await readItems(listId);
    later(1000);
    const written = await importEntries(listId, parseList("Market\n❗ 2 kg Domates\n• Süt (Pınar olsun)\n• domates (salkım)\n• Ekmek"));
    expect(await readItems(listId)).toMatchObject([
      { name: "Domates", quantityMilli: 2000, unit: "kg", note: "salkım", urgent: true, checkedAt: null },
      { name: "Ekmek", note: null, urgent: false },
      // Already in the basket, the product stays there and takes the note.
      { id: sut, note: "Pınar olsun", checkedAt: T0.toISOString() },
    ]);
    await undoSave(written!, listId);
    expect(await readItems(listId)).toEqual(before);
  });

  it("keeps a note by the note's rules, and refuses the undo once an item has changed since", async () => {
    const written = await importEntries(listId, parseList(`• Peynir (  beyaz   ${"x".repeat(NOTE_MAX)} )\n• Zeytin`));
    const [peynir, zeytin] = await readItems(listId);
    expect(peynir!.note).toBe(`beyaz ${"x".repeat(NOTE_MAX)}`.slice(0, NOTE_MAX));
    await toggleChecked(zeytin!.id);
    await expect(undoSave(written!, listId)).rejects.toThrow(/changed since/);
    expect(await names(listId)).toEqual(["Peynir", "Zeytin"]);
  });

  it("writes nothing for a paste that names nothing or only what is here, and refuses a deleted list", async () => {
    expect(await importEntries(listId, parseList("Market\n• \n\n"))).toBeNull();
    expect(outboxCount()).toBe(0);
    await addItems(listId, "2 kg domates");
    expect(await importEntries(listId, parseList("• Domates\n• 2 kg domates"))).toBeNull();
    expect(outboxCount()).toBe(1);
    await deleteList(listId);
    await expect(importEntries(listId, parseList("• süt"))).rejects.toThrow();
  });
});
