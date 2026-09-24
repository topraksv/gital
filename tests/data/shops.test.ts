/**
 * Finishing a shop and its history (SPEC 3.4, 3.5) over the real migrations
 * and write layer: what is in the basket moves to the shop and leaves the
 * list, what was not bought stays, an undo puts it back, and history adds any
 * of it again.
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

const { addEntries, deleteItem, readItems, readShopItems, toggleChecked, updateItem } = await import("../../src/data/items");
const { parseEntry } = await import("../../src/domain/items");
/** The quick-add field's Enter. */
const addItems = (list: string, text: string) => addEntries(list, parseEntry(text));
const { finishShop, readShops, reopenShop } = await import("../../src/data/shops");
const { createList, deleteList, readLists } = await import("../../src/data/lists");
const { deterministicId, naturalKeys } = await import("../../src/db/ids");
const { migratedDatabase } = await import("../helpers");
const { tr } = await import("../../src/i18n/tr");

const T0 = new Date("2026-09-24T10:00:00.000Z");
const later = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));

let listId: string;

/** Adds the entry, ticks the products named in `bought`, and returns every id in entry order. */
async function shopFor(entry: string, bought: string[]): Promise<string[]> {
  const ids = await addItems(listId, entry);
  const items = await readItems(listId);
  for (const item of items) if (bought.includes(item.name)) await toggleChecked(item.id);
  return ids;
}

/** Finishes the list's shop and returns its id, failing the test when the basket was empty. */
async function finish(): Promise<string> {
  const shop = await finishShop(listId);
  if (!shop) throw new Error("Nothing was in the basket");
  return shop.id;
}

/** Rows queued for sync, per table. */
function queued(): Record<string, number> {
  const rows = harness.db!.prepare("SELECT table_name, COUNT(*) AS n FROM outbox GROUP BY table_name").all() as { table_name: string; n: number }[];
  return Object.fromEntries(rows.map((row) => [row.table_name, Number(row.n)]));
}

const history = async (shopId: string) => (await readShopItems(shopId)).map(({ name, quantityMilli, checkedAt }) => ({ name, quantityMilli, checkedAt }));

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

describe("finishShop", () => {
  it("moves the basket to one shop and leaves what was not bought on the list", async () => {
    const [sut, ekmek, peynir] = await addItems(listId, "2 lt süt, ekmek, peynir");
    await toggleChecked(sut!);
    later(1000);
    await toggleChecked(peynir!);
    later(60_000);
    const shop = await finishShop(listId);
    expect(shop).toEqual({ id: expect.any(String), bought: 2 });
    expect(await readItems(listId)).toMatchObject([{ id: ekmek, name: "Ekmek", checkedAt: null }]);
    expect(await history(shop!.id)).toEqual([
      { name: "Peynir", quantityMilli: null, checkedAt: new Date(T0.getTime() + 1000).toISOString() },
      { name: "Süt", quantityMilli: 2000, checkedAt: T0.toISOString() },
    ]);
    expect(await readShops()).toEqual([
      { id: shop!.id, listId, listName: "Market", finishedAt: new Date(T0.getTime() + 60_000).toISOString(), bought: 2 },
    ]);
  });

  it("gives a list's next shop, and what it bought, the same ids on every device", async () => {
    await shopFor("süt", ["Süt"]);
    const first = await finish();
    expect(first).toBe(await deterministicId(naturalKeys.shop(listId, 1)));
    expect((await readShopItems(first)).map((item) => item.id)).toEqual([await deterministicId(naturalKeys.boughtItem(first, "sut"))]);
    await shopFor("ekmek", ["Ekmek"]);
    expect(await finish()).toBe(await deterministicId(naturalKeys.shop(listId, 2)));
  });

  it("finishes nothing while the basket is empty", async () => {
    await addItems(listId, "süt");
    expect(await finishShop(listId)).toBeNull();
    expect(await readShops()).toEqual([]);
  });

  it("refuses a list deleted under the screen", async () => {
    await shopFor("süt", ["Süt"]);
    await deleteList(listId);
    await expect(finishShop(listId)).rejects.toThrow();
  });

  it("queues every row a finish and its undo write for sync", async () => {
    await shopFor("süt, ekmek", ["Süt", "Ekmek"]);
    const before = queued();
    later(1000);
    const shopId = await finish();
    // Each bought item: its list row tombstoned, and its copy.
    expect(queued()).toEqual({ ...before, items: before.items! + 4, shops: 1 });
    later(2000);
    await reopenShop(shopId);
    expect(queued()).toEqual({ ...before, items: before.items! + 8, shops: 2 });
  });
});

describe("the list after a shop", () => {
  it("brings a product bought and needed again back fresh, and history keeps what was bought", async () => {
    const [sut] = await shopFor("2 süt", ["Süt"]);
    const shopId = await finish();
    expect(await addItems(listId, "süt")).toEqual([sut]);
    expect(await readItems(listId)).toMatchObject([{ id: sut, quantityMilli: null, checkedAt: null }]);
    expect(await history(shopId)).toMatchObject([{ name: "Süt", quantityMilli: 2000 }]);
  });

  it("merges a product added again into the one that was not bought and stayed", async () => {
    const [sut] = await shopFor("süt, ekmek", ["Ekmek"]);
    await finish();
    await addItems(listId, "3 süt");
    expect(await readItems(listId)).toMatchObject([{ id: sut, quantityMilli: 3000 }]);
  });

  it("counts only what is still on the list on its card", async () => {
    await shopFor("süt, ekmek, peynir", ["Süt", "Ekmek"]);
    await finish();
    expect(await readLists()).toMatchObject([{ name: "Market", total: 1, inBasket: 0 }]);
  });

  it("refuses to tick or edit what a shop took under the screen, and has nothing there to delete", async () => {
    const [sut] = await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    await expect(toggleChecked(sut!)).rejects.toThrow();
    await expect(updateItem(sut!, { name: "Ayran", quantityMilli: null, unit: null, note: null, urgent: false })).rejects.toThrow();
    expect(await deleteItem(sut!)).toBeNull();
    expect(await history(shopId)).toMatchObject([{ name: "Süt" }]);
  });
});

describe("reopenShop", () => {
  it("puts what a shop took back in the basket, and the next finish is the same shop again", async () => {
    const [sut, ekmek] = await shopFor("süt, ekmek", ["Süt"]);
    const shopId = await finish();
    await reopenShop(shopId);
    expect(await readItems(listId)).toMatchObject([
      { id: ekmek, checkedAt: null },
      { id: sut, checkedAt: T0.toISOString() },
    ]);
    expect(await readShops()).toEqual([]);
    later(1000);
    expect(await finish()).toBe(shopId);
    expect(await readShops()).toMatchObject([{ id: shopId, finishedAt: new Date(T0.getTime() + 1000).toISOString(), bought: 1 }]);
  });

  it("keeps a product added again before the undo as it is, once", async () => {
    await shopFor("2 lt süt", ["Süt"]);
    const shopId = await finish();
    await addItems(listId, "süt");
    await reopenShop(shopId);
    expect(await readItems(listId)).toMatchObject([{ name: "Süt", quantityMilli: null, checkedAt: null }]);
  });

  it("finishes again with only what is in the basket now", async () => {
    await shopFor("süt, ekmek", ["Süt", "Ekmek"]);
    const shopId = await finish();
    await reopenShop(shopId);
    const ekmek = (await readItems(listId)).find((item) => item.name === "Ekmek")!;
    await toggleChecked(ekmek.id);
    later(1000);
    expect(await finish()).toBe(shopId);
    expect(await history(shopId)).toMatchObject([{ name: "Süt" }]);
    expect(await readShops()).toMatchObject([{ id: shopId, bought: 1 }]);
    expect(await readItems(listId)).toMatchObject([{ id: ekmek.id, checkedAt: null }]);
  });

  it("refuses the undo of a shop whose list was deleted", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    await deleteList(listId);
    await expect(reopenShop(shopId)).rejects.toThrow();
  });

  it("refuses a shop already undone", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    await reopenShop(shopId);
    await expect(reopenShop(shopId)).rejects.toThrow();
  });
});

describe("readShops", () => {
  it("lists every list's shops, the latest first, and leaves out a deleted list's", async () => {
    await shopFor("süt", ["Süt"]);
    const first = await finish();
    const other = await createList("Pazar");
    const [biber] = await addItems(other, "biber, domates");
    await toggleChecked(biber!);
    later(1000);
    const second = (await finishShop(other))!.id;
    expect((await readShops()).map((shop) => [shop.id, shop.listName, shop.bought])).toEqual([
      [second, "Pazar", 1],
      [first, "Market", 1],
    ]);
    await deleteList(other);
    expect((await readShops()).map((shop) => shop.id)).toEqual([first]);
  });
});

describe("addEntries from history", () => {
  it("puts a bought product back on its list with its quantity", async () => {
    await shopFor("2 lt süt", ["Süt"]);
    const [item] = await readShopItems(await finish());
    const [back] = await addEntries(listId, [item!]);
    expect(await readItems(listId)).toEqual([{ id: back, name: "Süt", quantityMilli: 2000, unit: "lt", checkedAt: null, note: null, urgent: false }]);
    expect(back).not.toBe(item!.id);
  });

  it("merges into the product when it is already on the list, keeping that row's tick", async () => {
    await shopFor("2 lt süt", ["Süt"]);
    const shopId = await finish();
    const [needed] = await addItems(listId, "süt");
    await toggleChecked(needed!);
    await addEntries(listId, await readShopItems(shopId));
    expect(await readItems(listId)).toMatchObject([{ id: needed, quantityMilli: 2000, unit: "lt", checkedAt: T0.toISOString() }]);
  });
});

describe("a shop's summary", () => {
  it("shows a stamp it cannot read as it is instead of throwing", () => {
    expect(tr.history.summary("2026-09-24 10:00:00+00 bozuk", 2)).toBe("2026-09-24 10:00:00+00 bozuk · 2 ürün");
    expect(tr.history.summary(T0.toISOString(), 1)).toMatch(/2026.* · 1 ürün$/);
  });
});
