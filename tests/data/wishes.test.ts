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

const { addWish, deleteWishes, fillFromPage, unpricedLinksOf, readCollections, readDueWishes, readKnownWishes, readWishes, restoreWish, saveWish, toggleWishBought } = await import("../../src/data/wishes");
const { createList, deleteLists, readLists } = await import("../../src/data/lists");
const { readPhoto } = await import("../../src/data/photos");
const { setActor, writeRows } = await import("../../src/db/mutations");
const { migratedDatabase } = await import("../helpers");

const T0 = new Date("2026-09-26T10:00:00.000Z");
const later = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));
const change = (over: Partial<Parameters<typeof saveWish>[1]> = {}) => ({
  name: "Kahve makinesi",
  note: "",
  priority: 1 as const,
  estimateMinor: null,
  dueOn: null,
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

  it("are owned unless this person only edits or views them", async () => {
    const DENIZ = "d0000000-0000-4000-8000-00000000000d";
    const viewed = await createList("Hediye", "wish");
    await writeRows([{ table: "list_members", row: { id: crypto.randomUUID(), listId: viewed, userId: DENIZ, role: "viewer" } }]);
    setActor(DENIZ);
    try {
      const owner = Object.fromEntries((await readCollections()).map((each) => [each.id, each.owner]));
      expect(owner).toEqual({ [collection]: true, [viewed]: false });
    } finally {
      setActor(null);
    }
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
    await deleteLists([collection]);
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

  it("finds the link in what a shop's share sheet wrote, and keeps the rest as the note", async () => {
    await addWish(collection, "Şuna bir bak! Krups Kahve Makinesi https://ty.gl/abc123");
    expect(await readWishes(collection)).toMatchObject([{ name: "Trendyol", note: "Şuna bir bak! Krups Kahve Makinesi", links: [{ url: "https://ty.gl/abc123" }] }]);
  });

  it("refuses an empty name and a collection that is gone or is a shopping list", async () => {
    await expect(addWish(collection, "  ")).rejects.toThrow();
    await expect(addWish(await createList("Market"), "Kettle")).rejects.toThrow();
    await deleteLists([collection]);
    await expect(addWish(collection, "Kettle")).rejects.toThrow();
  });
});

describe("readKnownWishes", () => {
  // The add field's suggestions (SPEC 2.4 on İstekler, the owner asked
  // 2026-09-27): every wish named before, in any live collection, however
  // it is spelt, the latest spelling kept and counted once per wish.
  it("offers each name once, the latest first, and leaves out a deleted wish or collection", async () => {
    await addWish(collection, "Kahve makinesi");
    later(1000);
    await addWish(collection, "kahve  makinesi");
    later(2000);
    await addWish(collection, "Kulaklık");
    const gone = await addWish(collection, "Masa lambası");
    await deleteWishes([gone]);
    const other = await createList("Eski", "wish");
    await addWish(other, "Bisiklet");
    await deleteLists([other]);
    expect(await readKnownWishes()).toEqual([
      { key: "kulaklik", name: "Kulaklık", times: 1 },
      { key: "kahve makinesi", name: "Kahve makinesi", times: 2 },
    ]);
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

describe("a wish's date", () => {
  it("is kept and taken off, refused when it is not a day, and read for the reminders only while its collection lives", async () => {
    const kettle = await addWish(collection, "Kettle");
    await saveWish(kettle, change({ name: "Kettle", dueOn: "2026-10-15" }));
    expect(await readWishes(collection)).toMatchObject([{ dueOn: "2026-10-15" }]);
    expect(await readDueWishes()).toEqual([{ name: "Kettle", dueOn: "2026-10-15", boughtAt: null }]);
    await expect(saveWish(kettle, change({ dueOn: "15.10.2026" as never }))).rejects.toThrow();
    await saveWish(kettle, change({ name: "Kettle" }));
    expect(await readDueWishes()).toEqual([]);
    await saveWish(kettle, change({ name: "Kettle", dueOn: "2026-10-15" }));
    await deleteLists([collection]);
    expect(await readDueWishes()).toEqual([]);
  });
});

describe("deleteWishes", () => {
  it("deletes a wish with its links out of sight, and undo brings it back whole", async () => {
    const id = await addWish(collection, "https://a.com/x");
    const snapshot = await deleteWishes([id]);
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

describe("a link's page (SPEC 7.2)", () => {
  const shot = { data: "data:image/jpeg;base64,full", thumb: "data:image/jpeg;base64,thumb" };
  const found = { name: "Krups KM480D10 Kahve Makinesi", priceMinor: 674_900, photo: shot };

  it("names a wish still called after its shop, prices the link and gives the wish its picture", async () => {
    const id = await addWish(collection, "https://www.trendyol.com/krups/km480-p-925787811");
    const { links } = (await readWishes(collection))[0]!;
    expect(await unpricedLinksOf(id)).toEqual([{ id: links[0]!.id, url: "https://www.trendyol.com/krups/km480-p-925787811" }]);
    await fillFromPage(links[0]!.id, found);
    const [wish] = await readWishes(collection);
    expect(wish).toMatchObject({ name: "Krups KM480D10 Kahve Makinesi", photo: shot.thumb, links: [{ priceMinor: 674_900 }] });
    expect(await readPhoto(wish!.photoId!)).toBe(shot.data);
    expect(await unpricedLinksOf(id)).toEqual([]);
  });

  it("never overwrites what the person gave: a name of their own, a price, a photo", async () => {
    const id = await addWish(collection, "https://www.trendyol.com/krups/km480-p-925787811");
    const { links } = (await readWishes(collection))[0]!;
    const own = { data: "data:image/jpeg;base64,own", thumb: "data:image/jpeg;base64,ownthumb" };
    await saveWish(id, change({ name: "Annemin kahve makinesi", photo: own, links: [{ ...links[0]!, priceMinor: 500_000 }] }));
    await fillFromPage(links[0]!.id, found);
    expect(await readWishes(collection)).toMatchObject([{ name: "Annemin kahve makinesi", photo: own.thumb, links: [{ priceMinor: 500_000 }] }]);
  });

  it("writes nothing when the page found nothing new, or the wish is gone", async () => {
    const id = await addWish(collection, "https://www.amazon.com.tr/dp/B0CZY1V3XP");
    const { links } = (await readWishes(collection))[0]!;
    const outbox = () => (harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
    const before = outbox();
    await fillFromPage(links[0]!.id, { name: null, priceMinor: null, photo: null });
    expect(outbox()).toBe(before);
    await deleteWishes([id]);
    await fillFromPage(links[0]!.id, found);
    expect(live("wishes")).toEqual([]);
  });

  // A link names its wish by id alone, and any editor of another list the
  // device reads can write one there naming this wish (SECURITY.md).
  it("belong to a wish only in the wish's own collection", async () => {
    const id = await addWish(collection, "Kahve makinesi");
    const elsewhere = await createList("Başkası", "wish");
    const at = T0.toISOString();
    for (const [link, price] of [["0190a000-0000-7000-8000-000000000001", 777_700], ["0190a000-0000-7000-8000-000000000002", null]] as const) {
      harness.db!
        .prepare("INSERT INTO wish_links (id, created_at, updated_at, list_id, wish_id, url, price_minor) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(link, at, at, elsewhere, id, "https://example.com/p", price);
    }
    expect((await readCollections()).find((held) => held.id === collection)).toMatchObject({ openTotalMinor: null });
    expect(await unpricedLinksOf(id)).toEqual([]);
    await fillFromPage("0190a000-0000-7000-8000-000000000002", found);
    expect(await readWishes(collection)).toMatchObject([{ name: "Kahve makinesi", photo: null }]);
    await saveWish(id, change());
    expect(live("wish_links")).toHaveLength(2);
  });
});
