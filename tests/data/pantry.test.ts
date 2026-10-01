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
const { finishPantryItem, readLasted, readPantry, removePantryItem, reorderPantry, setExpiry, setStock, stockPantry, takeSome, undoFinish } = await import("../../src/data/pantry");
const { parseEntry } = await import("../../src/domain/items");
const { setActor } = await import("../../src/db/mutations");
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

describe("stockPantry", () => {
  it("puts what is already at home in the pantry by hand, one piece where no quantity was given", async () => {
    await stockPantry(parseEntry("2 kg un, tuz"));
    expect(await stock()).toEqual([
      { name: "Tuz", quantityMilli: 1000, unit: "adet" },
      { name: "Un", quantityMilli: 2000, unit: "kg" },
    ]);
  });

  it("adds to what a shop brought, and finishing it later still returns it to that shop's list", async () => {
    await shop(market, "süt");
    await stockPantry(parseEntry("2 süt"));
    expect(await stock()).toEqual([{ name: "Süt", quantityMilli: 3000, unit: "adet" }]);
    const finished = await finishPantryItem(await idOf("Süt"));
    expect(finished.listName).toBe("Market");
  });

  it("brings back a product that was finished, on no list when none brought it", async () => {
    await stockPantry(parseEntry("pirinç"));
    const finished = await finishPantryItem(await idOf("Pirinç"));
    expect(finished.listName).toBeNull();
    await stockPantry(parseEntry("pirinç"));
    expect(await stock()).toEqual([{ name: "Pirinç", quantityMilli: 1000, unit: "adet" }]);
  });

  // A pasted message is taken back whole from the bar, as on a list (SPEC 6.2).
  it("is taken back whole by its undo", async () => {
    await stockPantry(parseEntry("un"));
    tick();
    const written = await stockPantry(parseEntry("2 un, tuz"));
    expect(written.writes.length).toBeGreaterThan(0);
    await undoFinish(written);
    expect(await stock()).toEqual([{ name: "Un", quantityMilli: 1000, unit: "adet" }]);
  });
});

// Kiler sorts as a list does, by its grips (SPEC 4.1 in Kiler, the owner asked 2026-09-27).
describe("reorderPantry", () => {
  it("keeps the dragged order, and puts a product that arrives later above it", async () => {
    await stockPantry(parseEntry("un, tuz, şeker"));
    await reorderPantry([await idOf("Tuz"), await idOf("Un"), await idOf("Şeker")]);
    expect((await stock()).map((item) => item.name)).toEqual(["Tuz", "Un", "Şeker"]);
    tick();
    await stockPantry(parseEntry("pirinç"));
    expect((await stock()).map((item) => item.name)).toEqual(["Pirinç", "Tuz", "Un", "Şeker"]);
  });

  it("leaves out what is no longer at home", async () => {
    await stockPantry(parseEntry("un, tuz"));
    const un = await idOf("Un");
    await finishPantryItem(un);
    await reorderPantry([await idOf("Tuz"), un]);
    expect((await stock()).map((item) => item.name)).toEqual(["Tuz"]);
  });
});

// Deleted from the panel: gone from home, and put on no list, since it did
// not run out — it was never there, or it was thrown away.
describe("removePantryItem", () => {
  it("takes it out without putting it on its list, and the undo brings it back", async () => {
    await shop(market, "2 süt");
    const written = await removePantryItem(await idOf("Süt"));
    expect(await stock()).toEqual([]);
    expect(await readItems(market)).toEqual([]);
    await undoFinish(written);
    expect(await stock()).toEqual([{ name: "Süt", quantityMilli: 2000, unit: "adet" }]);
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

describe("setStock", () => {
  it("counts what is at home anew, in the unit it is held in", async () => {
    await shop(market, "2 kg domates");
    expect(await setStock(await idOf("Domates"), 750)).toBeNull();
    expect(await stock()).toEqual([{ name: "Domates", quantityMilli: 750, unit: "kg" }]);
    tick();
    await setStock(await idOf("Domates"), 3000);
    expect(await stock()).toEqual([{ name: "Domates", quantityMilli: 3000, unit: "kg" }]);
  });

  it("finishes the product at nothing, and refuses what is not an amount", async () => {
    await shop(market, "süt");
    const id = await idOf("Süt");
    for (const bad of [-1000, 1.5, Number.NaN]) await expect(setStock(id, bad)).rejects.toThrow();
    expect((await setStock(id, 0))?.listName).toBe("Market");
    expect(await stock()).toEqual([]);
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

  it("puts it on no list this person only views: in a household, the list may be another member's (SPEC 12.13)", async () => {
    const DENIZ = "22222222-2222-4222-8222-222222222222";
    await shop(market, "süt");
    harness.db!.prepare(
      "INSERT INTO list_members (id, created_at, updated_at, list_id, user_id, role) VALUES ('019f0000-0000-7000-8000-000000000001', '', '', ?, ?, 'viewer')",
    ).run(market, DENIZ);
    setActor(DENIZ);
    try {
      expect((await finishPantryItem(await idOf("Süt"))).listName).toBeNull();
      expect(await readItems(market)).toEqual([]);
    } finally {
      setActor(null);
    }
  });

  it("refuses what is no longer at home", async () => {
    await shop(market, "süt");
    const id = await idOf("Süt");
    await finishPantryItem(id);
    await expect(finishPantryItem(id)).rejects.toThrow();
    await expect(takeSome(id)).rejects.toThrow();
  });
});

describe("readLasted", () => {
  it("measures how long each product stayed at home, from its arrival to its finish (SPEC 12.7)", async () => {
    const DAY = 86_400_000;
    const at = (day: number) => vi.setSystemTime(new Date(T0.getTime() + day * DAY));
    await shop(market, "süt, ekmek");
    at(3);
    await finishPantryItem(await idOf("Süt"));
    await addEntries(market, parseEntry("süt"));
    for (const item of await readItems(market)) await toggleChecked(item.id);
    at(4);
    await finishShop(market);
    at(8);
    await finishPantryItem(await idOf("Süt"));
    const lasted = new Map(await readLasted());
    expect(lasted.get("sut")?.map((ms) => Math.round(ms / DAY))).toEqual([3, 4]);
    expect(lasted.get("ekmek")).toEqual([]);
  });
});

describe("setExpiry", () => {
  it("dates a product at home and takes the date off again (SPEC 12.3)", async () => {
    await shop(market, "süt");
    const id = await idOf("Süt");
    await setExpiry(id, "2026-10-03");
    expect(await readPantry()).toMatchObject([{ name: "Süt", expiresOn: "2026-10-03" }]);
    await setExpiry(id, null);
    expect(await readPantry()).toMatchObject([{ name: "Süt", expiresOn: null }]);
  });

  it("refuses a day that is not one", async () => {
    await shop(market, "süt");
    await expect(setExpiry(await idOf("Süt"), "2026-02-30")).rejects.toThrow();
  });

  it("goes with the stay: finishing clears it, and its undo brings it back", async () => {
    await shop(market, "süt");
    const id = await idOf("Süt");
    await setExpiry(id, "2026-10-03");
    const finished = await finishPantryItem(id);
    const stored = () => harness.db!.prepare("SELECT expires_on FROM pantry_items WHERE id = ?").get(id);
    expect(stored()).toEqual({ expires_on: null });
    tick();
    await undoFinish(finished.written);
    expect(await readPantry()).toMatchObject([{ name: "Süt", expiresOn: "2026-10-03" }]);
  });
});
