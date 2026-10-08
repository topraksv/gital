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

const { addEntries, deleteItems, readItems, readShopItems, toggleChecked, updateItem } = await import("../../src/data/items");
const { parseEntry } = await import("../../src/domain/items");
/** The quick-add field's Enter. */
const addItems = (list: string, text: string) => addEntries(list, parseEntry(text));
const { finishShop, readPricedSince, readPurchases, readShops, reopenShop, setShopReceipt, setShopTotal } = await import("../../src/data/shops");
const { readPhoto } = await import("../../src/data/photos");
const { createList, deleteLists, readLists } = await import("../../src/data/lists");
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
    expect(shop).toEqual({ id: expect.any(String), bought: 2, spentMinor: null, stocked: 2, stayed: [ekmek] });
    expect(await readItems(listId)).toMatchObject([{ id: ekmek, name: "Ekmek", checkedAt: null }]);
    expect(await history(shop!.id)).toEqual([
      { name: "Peynir", quantityMilli: null, checkedAt: new Date(T0.getTime() + 1000).toISOString() },
      { name: "Süt", quantityMilli: 2000, checkedAt: T0.toISOString() },
    ]);
    expect(await readShops()).toEqual([
      { id: shop!.id, listId, listName: "Market", color: null, icon: "cart", finishedAt: new Date(T0.getTime() + 60_000).toISOString(), bought: 2, spentMinor: null, totalMinor: null, summedMinor: null, receiptId: null, receipt: null },
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

  // The finish card's total: a tick that lands as Bitir is pressed is bought,
  // so a sum of the screen's last basket would miss it.
  it("spends what it filed, a tick the screen had not drawn included", async () => {
    const [sut, ekmek] = await addItems(listId, "süt, ekmek");
    // A price puts an item in the basket (SPEC 3.7).
    const paid = (name: string, priceMinor: number) => ({ name, quantityMilli: null, unit: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor });
    await updateItem(sut!, paid("Süt", 1000));
    const drawn = (await readItems(listId)).filter((item) => item.checkedAt != null);
    await updateItem(ekmek!, paid("Ekmek", 500));
    const shop = await finishShop(listId);
    expect(drawn).toHaveLength(1);
    expect(shop).toMatchObject({ bought: 2, spentMinor: 1500 });
    expect((await readShops())[0]!.spentMinor).toBe(1500);
  });

  it("finishes nothing while the basket is empty", async () => {
    await addItems(listId, "süt");
    expect(await finishShop(listId)).toBeNull();
    expect(await readShops()).toEqual([]);
  });

  it("refuses a list deleted under the screen", async () => {
    await shopFor("süt", ["Süt"]);
    await deleteLists([listId]);
    await expect(finishShop(listId)).rejects.toThrow();
  });

  it("queues every row a finish and its undo write for sync", async () => {
    await shopFor("süt, ekmek", ["Süt", "Ekmek"]);
    const before = queued();
    later(1000);
    const shopId = await finish();
    // Each bought item: its list row tombstoned, its copy, and what it brought home.
    expect(queued()).toEqual({ ...before, items: before.items! + 4, shops: 1, pantry_items: 2, pantry_moves: 2 });
    later(2000);
    await reopenShop(shopId);
    expect(queued()).toEqual({ ...before, items: before.items! + 8, shops: 2, pantry_items: 2, pantry_moves: 4 });
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
    await expect(updateItem(sut!, { name: "Ayran", quantityMilli: null, unit: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null })).rejects.toThrow();
    expect(await deleteItems([sut!])).toBeNull();
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
    await deleteLists([listId]);
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
    await deleteLists([other]);
    expect((await readShops()).map((shop) => shop.id)).toEqual([first]);
  });

  it("counts only the shop's own list's items, whatever shop another list's row names", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    // A shop's id is a hash of its list's: a co-member writing into a list they share can name it.
    const other = await createList("Ev");
    const [planted] = await addItems(other, "altın");
    harness.db!.prepare("UPDATE items SET shop_id = ?, price_minor = 500000 WHERE id = ?").run(shopId, planted!);
    expect((await readShops()).map((shop) => [shop.id, shop.bought, shop.spentMinor])).toEqual([[shopId, 1, null]]);
    expect((await readShopItems(shopId)).map((item) => item.name)).toEqual(["Süt"]);
    expect((await readPurchases(listId)).map((item) => item.name)).toEqual(["Süt"]);
    expect(await readPricedSince(T0.toISOString())).toEqual([]);
  });
});

describe("a shop's total corrected to the receipt", () => {
  const spent = async () => (await readShops()).map(({ spentMinor }) => spentMinor);

  it("replaces the sum of the prices, and cleared goes back to it", async () => {
    const [sut] = await shopFor("süt, ekmek", ["Ekmek"]);
    await updateItem(sut!, { name: "Süt", quantityMilli: null, unit: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: 4590 });
    const shopId = await finish();
    expect(await spent()).toEqual([4590]);
    await setShopTotal(shopId, 61275);
    expect(await spent()).toEqual([61275]);
    await setShopTotal(shopId, null);
    expect(await spent()).toEqual([4590]);
  });

  it("is a total of its own when nothing was priced, and queues the shop for sync", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    later(1000);
    await setShopTotal(shopId, 0);
    expect(await spent()).toEqual([0]);
    const last = harness.db!.prepare("SELECT payload FROM outbox WHERE table_name = 'shops' ORDER BY id DESC LIMIT 1").get() as { payload: string };
    expect(JSON.parse(last.payload)).toMatchObject({ id: shopId, total_minor: 0 });
  });

  it("goes with an undo: the same shop finished again is summed afresh", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    await setShopTotal(shopId, 10000);
    await reopenShop(shopId);
    expect(await finish()).toBe(shopId);
    expect(await spent()).toEqual([null]);
  });

  it("refuses a total that is not whole, non-negative kuruş, and a shop undone or gone", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    for (const total of [-1, 0.5, Number.NaN]) await expect(setShopTotal(shopId, total), String(total)).rejects.toThrow();
    await reopenShop(shopId);
    await expect(setShopTotal(shopId, 100)).rejects.toThrow();
  });
});

// The receipt's photo on a finished shop (the owner asked 2026-09-27).
describe("a shop's receipt", () => {
  const shot = { data: "data:image/jpeg;base64,full", thumb: "data:image/jpeg;base64,thumb" };

  it("is kept on the shop, shown by its thumbnail, opened full, and taken off again", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    await setShopReceipt(shopId, shot);
    const [shop] = await readShops();
    expect(shop).toMatchObject({ receipt: shot.thumb });
    expect(await readPhoto(shop!.receiptId!)).toBe(shot.data);
    await setShopReceipt(shopId, null);
    expect(await readShops()).toMatchObject([{ receiptId: null, receipt: null }]);
  });

  it("refuses what the app did not encode, and a shop that is gone", async () => {
    await shopFor("süt", ["Süt"]);
    const shopId = await finish();
    await expect(setShopReceipt(shopId, { data: "https://x/y.jpg", thumb: "x" })).rejects.toThrow();
    await reopenShop(shopId);
    await expect(setShopReceipt(shopId, shot)).rejects.toThrow();
  });
});

describe("addEntries from history", () => {
  it("puts a bought product back on its list with its quantity", async () => {
    await shopFor("2 lt süt", ["Süt"]);
    const [item] = await readShopItems(await finish());
    const [back] = await addEntries(listId, [item!]);
    expect(await readItems(listId)).toEqual([{ id: back, name: "Süt", quantityMilli: 2000, unit: "lt", checkedAt: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null, photoId: null, photo: null, addedBy: null, checkedBy: null, createdAt: expect.any(String) }]);
    expect(back).not.toBe(item!.id);
  });

  it("brings a product back without the note and urgency it was bought with", async () => {
    await shopFor("süt", ["Süt"]);
    const [item] = await readShopItems(await finish());
    const noted = { ...item!, note: "Pınar olsun", urgent: true };
    await addEntries(listId, [noted]);
    expect(await readItems(listId)).toMatchObject([{ name: "Süt", note: null, urgent: false }]);
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
    expect(tr.history.summary("2026-09-24 10:00:00+00 bozuk", 2)).toBe("2026-09-24 10:00:00+00 bozuk · 2\u00a0ürün");
    expect(tr.history.summary(T0.toISOString(), 1)).toMatch(/2026.* · 1\u00a0ürün$/);
  });

  it("says what the shop cost when anything was priced, and nothing when not, which is not ₺0", () => {
    expect(tr.history.spent(5840)).toBe("₺58,40");
    expect(tr.history.spent(0)).toBe("₺0,00");
    expect(tr.history.spent(null)).toBeUndefined();
    expect(tr.items.basket(5840)).toBe("Sepette · ₺58,40");
    expect(tr.items.basket(null)).toBe("Sepette");
  });
});

describe("readPurchases", () => {
  it("reads what this list's shops bought, latest first, without an undone shop or another list's", async () => {
    await shopFor("2 lt süt, ekmek", ["Süt"]);
    await finish();
    later(1000);
    await shopFor("ekmek", ["Ekmek"]);
    await finish();
    later(2000);
    await shopFor("süt", ["Süt"]);
    await reopenShop(await finish());
    const other = await createList("Pazar");
    await addItems(other, "domates");
    await toggleChecked((await readItems(other))[0]!.id);
    await finishShop(other);
    expect(await readPurchases(listId)).toEqual([
      { name: "Ekmek", quantityMilli: null, unit: null, boughtAt: new Date(T0.getTime() + 1000).toISOString() },
      { name: "Süt", quantityMilli: 2000, unit: "lt", boughtAt: T0.toISOString() },
    ]);
  });
});

describe("readPricedSince", () => {
  const priced = (name: string, priceMinor: number | null) => ({ name, quantityMilli: null, unit: null, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor });

  it("reads what shops finished since then bought with a price, from lists still kept", async () => {
    const [sut, ekmek] = await addItems(listId, "süt, ekmek, peynir");
    await updateItem(sut!, priced("Süt", 4590));
    await updateItem(ekmek!, priced("Ekmek", 1250));
    await toggleChecked((await readItems(listId)).find((item) => item.name === "Peynir")!.id);
    await finish();
    later(60_000);
    const [ayran] = await addItems(listId, "ayran");
    await updateItem(ayran!, priced("Ayran", 900));
    await finish();
    const other = await createList("Eczane");
    const [pil] = await addEntries(other, parseEntry("pil"));
    await updateItem(pil!, priced("Pil", 5000));
    await finishShop(other);
    await deleteLists([other]);

    const byName = (rows: { name: string; priceMinor: number }[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(await readPricedSince(T0.toISOString()))).toEqual([
      { name: "Ayran", priceMinor: 900 },
      { name: "Ekmek", priceMinor: 1250 },
      { name: "Süt", priceMinor: 4590 },
    ]);
    expect(await readPricedSince(new Date(T0.getTime() + 1).toISOString())).toEqual([{ name: "Ayran", priceMinor: 900 }]);
  });
});
