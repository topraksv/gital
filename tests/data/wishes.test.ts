/**
 * The wish list over the real migrations and write layer, on Node's SQLite
 * (SPEC 7.1, 7.3, 7.4, 7.6): collections are lists of their own kind, kept off
 * Listeler; a wish is added by name or by a pasted link, saved with its links
 * in one write, ticked as bought, and deleted with undo.
 */

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});

const { addWish, deleteWish, readCollections, readWishes, restoreWish, saveWish, toggleWishBought } = await import("../../src/data/wishes");
const { createList, deleteList, readLists } = await import("../../src/data/lists");
const { readPhoto } = await import("../../src/data/photos");
const { migratedDatabase } = await import("../helpers");

const T0 = new Date("2026-09-26T10:00:00.000Z");
const later = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));
const change = (over: Partial<Parameters<typeof saveWish>[1]> = {}) => ({
  name: "Kahve makinesi",
  note: "",
  priority: 1 as const,
  estimateMinor: null,
  links: [],
  ...over,
});

function live(table: string, where = "1 = 1") {
  return harness.db!.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND ${where}`).all() as Record<string, unknown>[];
}

let collection: string;

beforeEach(async () => {
  harness.db = migratedDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  collection = await createList("Ev", "wish");
});

afterEach(() => {
  vi.useRealTimers();
  harness.db?.close();
});

describe("collections", () => {
  it("are kept off Listeler, and Listeler's lists off İstekler", async () => {
    const market = await createList("Market");
    expect((await readLists()).map((list) => list.id)).toEqual([market]);
    expect(await readCollections()).toMatchObject([{ id: collection, name: "Ev", open: 0, openTotalMinor: null }]);
  });

  it("count what is still wished and what it comes to", async () => {
    const kettle = await addWish(collection, "Kettle");
    await saveWish(kettle, change({ name: "Kettle", estimateMinor: 90000 }));
    const lamp = await addWish(collection, "Lamba");
    await saveWish(lamp, change({ name: "Lamba", links: [{ url: "https://www.trendyol.com/l", priceMinor: 45000 }] }));
    const done = await addWish(collection, "Halı");
    await saveWish(done, change({ name: "Halı", estimateMinor: 100000 }));
    await toggleWishBought(done);
    await addWish(await createList("Hediye", "wish"), "Kitap");
    expect(await readCollections()).toMatchObject([
      { id: collection, open: 2, openTotalMinor: 135000 },
      { name: "Hediye", open: 1, openTotalMinor: null },
    ]);
  });

  it("leave out a deleted collection and its wishes", async () => {
    await addWish(collection, "Kettle");
    await deleteList(collection);
    expect(await readCollections()).toEqual([]);
  });
});

describe("addWish", () => {
  it("adds a wish by its name", async () => {
    const id = await addWish(collection, "  kettle ");
    expect(await readWishes(collection)).toMatchObject([{ id, name: "Kettle", priority: 1, links: [] }]);
  });

  it("makes a pasted link a wish at that shop, holding the link", async () => {
    await addWish(collection, "ty.gl/abc123");
    expect(await readWishes(collection)).toMatchObject([{ name: "Trendyol", links: [{ url: "https://ty.gl/abc123", priceMinor: null }] }]);
  });

  it("refuses an empty name and a collection that is gone or is a shopping list", async () => {
    await expect(addWish(collection, "  ")).rejects.toThrow();
    await expect(addWish(await createList("Market"), "Kettle")).rejects.toThrow();
    await deleteList(collection);
    await expect(addWish(collection, "Kettle")).rejects.toThrow();
  });
});

describe("saveWish", () => {
  it("saves the wish and its links in one write: new links added, kept ones changed, dropped ones deleted", async () => {
    const id = await addWish(collection, "Kettle");
    await saveWish(id, change({ name: "Kettle", note: " beyaz ", priority: 2, estimateMinor: 80000, links: [{ url: "trendyol.com/k", priceMinor: 70000 }, { url: "https://hepsiburada.com/k", priceMinor: null }] }));
    const [saved] = await readWishes(collection);
    expect(saved).toMatchObject({ name: "Kettle", note: "beyaz", priority: 2, estimateMinor: 80000 });
    expect(saved!.links.map((link) => link.url)).toEqual(["https://trendyol.com/k", "https://hepsiburada.com/k"]);
    const [kept] = saved!.links;
    later(1000);
    await saveWish(id, change({ name: "Kettle", links: [{ id: kept!.id, url: kept!.url, priceMinor: 65000 }] }));
    expect((await readWishes(collection))[0]!.links).toEqual([{ id: kept!.id, url: "https://trendyol.com/k", priceMinor: 65000 }]);
    expect(live("wish_links")).toHaveLength(1);
  });

  it("refuses a link that is not a web page, a bad price or a priority it does not know, and writes nothing", async () => {
    const id = await addWish(collection, "Kettle");
    const before = live("wishes");
    await expect(saveWish(id, change({ links: [{ url: "javascript:alert(1)", priceMinor: null }] }))).rejects.toThrow();
    await expect(saveWish(id, change({ estimateMinor: -1 }))).rejects.toThrow();
    await expect(saveWish(id, change({ priority: 7 as never }))).rejects.toThrow();
    await expect(saveWish(id, change({ name: " " }))).rejects.toThrow();
    expect(live("wishes")).toEqual(before);
    expect(live("wish_links")).toEqual([]);
  });

  it("refuses a link id from another wish", async () => {
    const a = await addWish(collection, "https://a.com/x");
    const b = await addWish(collection, "Lamba");
    const [foreign] = (await readWishes(collection)).find((wish) => wish.id === a)!.links;
    await expect(saveWish(b, change({ name: "Lamba", links: [{ id: foreign!.id, url: foreign!.url, priceMinor: 1 }] }))).rejects.toThrow();
  });
});

describe("toggleWishBought and readWishes", () => {
  it("moves a bought wish to the end and back", async () => {
    const kettle = await addWish(collection, "Kettle");
    later(1000);
    const lamp = await addWish(collection, "Lamba");
    expect((await readWishes(collection)).map((wish) => wish.id)).toEqual([lamp, kettle]);
    await toggleWishBought(lamp);
    expect(await readWishes(collection)).toMatchObject([{ id: kettle, boughtAt: null }, { id: lamp, boughtAt: new Date(T0.getTime() + 1000).toISOString() }]);
    await toggleWishBought(lamp);
    expect((await readWishes(collection))[0]!.id).toBe(lamp);
  });
});

describe("deleteWish", () => {
  it("deletes a wish with its links out of sight, and undo brings it back whole", async () => {
    const id = await addWish(collection, "https://a.com/x");
    const snapshot = await deleteWish(id);
    expect(await readWishes(collection)).toEqual([]);
    await restoreWish(snapshot!);
    expect(await readWishes(collection)).toMatchObject([{ id, links: [{ url: "https://a.com/x" }] }]);
  });
});

describe("a wish's photo", () => {
  const shot = { data: "data:image/jpeg;base64,full", thumb: "data:image/jpeg;base64,thumb" };

  it("is saved with the panel, kept by a save that leaves it, and removed by null", async () => {
    const lamp = await addWish(collection, "Lamba");
    await saveWish(lamp, change({ name: "Lamba", photo: shot }));
    const [wish] = await readWishes(collection);
    expect(wish).toMatchObject({ photo: shot.thumb });
    expect(await readPhoto(wish!.photoId!)).toBe(shot.data);
    await saveWish(lamp, change({ name: "Lamba", note: "salon" }));
    expect(await readWishes(collection)).toMatchObject([{ photo: shot.thumb }]);
    await saveWish(lamp, change({ name: "Lamba", photo: null }));
    expect(await readWishes(collection)).toMatchObject([{ photoId: null, photo: null }]);
  });
});
