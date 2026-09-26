/**
 * The lists repository over the real migrations and write layer, on Node's
 * SQLite. What it holds is Helix's write contract as Gital's first table
 * inherits it: a row and its outbox event land together or not at all, a
 * delete is a tombstone, and undo brings back exactly what was deleted.
 */

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});

const { createList, deleteList, editList, readLists, restoreList } = await import("../../src/data/lists");
/** The list panel saved with only its name changed. */
const rename = (id: string, name: string) => editList(id, { name, color: null, icon: null });
const { migratedDatabase } = await import("../helpers");
const { withTransaction } = await import("../../src/db/client");

/** Let every started read reach the transaction queue. Only `Date` is faked here. */
const nextTask = () => new Promise((settle) => setTimeout(settle, 0));

interface OutboxRow {
  table_name: string;
  row_id: string;
  payload: string;
  idempotency_key: string;
}

function outbox(): OutboxRow[] {
  return harness.db!.prepare("SELECT table_name, row_id, payload, idempotency_key FROM outbox ORDER BY id").all() as unknown as OutboxRow[];
}

function stored(id: string) {
  return harness.db!.prepare("SELECT * FROM lists WHERE id = ?").get(id) as Record<string, unknown>;
}

const T0 = new Date("2026-09-23T10:00:00.000Z");

beforeEach(() => {
  harness.db = migratedDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  harness.db?.close();
});

describe("createList", () => {
  it("writes the list and its outbox event in one step", async () => {
    const id = await createList("  Market ");
    expect(stored(id)).toMatchObject({
      name: "Market",
      created_at: T0.toISOString(),
      updated_at: T0.toISOString(),
      deleted_at: null,
      tombstone_version: 0,
    });
    const events = outbox();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ table_name: "lists", row_id: id, idempotency_key: `lists:${id}:${T0.toISOString()}` });
    expect(JSON.parse(events[0]!.payload)).toEqual(stored(id));
  });

  it("mints a uuidv7 id", async () => {
    expect(await createList("Pazar")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("refuses a name with nothing in it, and writes nothing", async () => {
    await expect(createList("   ")).rejects.toThrow();
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM lists").get()).toEqual({ n: 0 });
    expect(outbox()).toHaveLength(0);
  });
});

describe("readLists", () => {
  it("returns the live lists, oldest first", async () => {
    const market = await createList("Market");
    vi.setSystemTime(new Date(T0.getTime() + 1000));
    const pazar = await createList("Pazar");
    vi.setSystemTime(new Date(T0.getTime() + 2000));
    const eczane = await createList("Eczane");
    await deleteList(pazar);
    expect(await readLists()).toEqual([
      { id: market, name: "Market", color: null, icon: null, pantry: true, total: 0, inBasket: 0 },
      { id: eczane, name: "Eczane", color: null, icon: null, pantry: true, total: 0, inBasket: 0 },
    ]);
  });

  it("orders lists made in the same millisecond by their id", async () => {
    const first = await createList("Bir");
    const second = await createList("İki");
    expect((await readLists()).map((list) => list.id)).toEqual([first, second].sort());
  });
});

describe("editList", () => {
  it("gives a list a colour and a picture of its own, and takes them back off", async () => {
    const id = await createList("Market");
    await editList(id, { name: "Market", color: "teal", icon: "cart" });
    expect(await readLists()).toMatchObject([{ id, color: "teal", icon: "cart" }]);
    await editList(id, { name: "Market", color: null, icon: null });
    expect(await readLists()).toMatchObject([{ id, color: null, icon: null }]);
  });

  it("turns a list's pantry switch off and on, and leaves it be when the save names none", async () => {
    const id = await createList("Nalbur");
    await editList(id, { name: "Nalbur", color: null, icon: null, pantry: false });
    expect(await readLists()).toMatchObject([{ id, pantry: false }]);
    await editList(id, { name: "Hırdavat", color: null, icon: null });
    expect(await readLists()).toMatchObject([{ id, name: "Hırdavat", pantry: false }]);
    await editList(id, { name: "Hırdavat", color: null, icon: null, pantry: true });
    expect(await readLists()).toMatchObject([{ id, pantry: true }]);
  });

  it("stores only a colour and a picture this build knows, and reads an unknown one as none", async () => {
    const id = await createList("Market");
    await expect(editList(id, { name: "Market", color: "gold" as never, icon: null })).rejects.toThrow();
    await expect(editList(id, { name: "Market", color: null, icon: "rocket" as never })).rejects.toThrow();
    expect(stored(id)).toMatchObject({ color: null, icon: null });
    // A newer device's colour or picture, arrived by sync, draws as the default.
    harness.db!.prepare("UPDATE lists SET color = 'gold', icon = 'rocket' WHERE id = ?").run(id);
    expect(await readLists()).toMatchObject([{ id, color: null, icon: null }]);
  });
});

describe("editList, renaming", () => {
  it("renames, stamps the edit and queues the whole row", async () => {
    const id = await createList("Market");
    const edited = new Date(T0.getTime() + 5000);
    vi.setSystemTime(edited);
    await rename(id, " Süpermarket ");
    expect(stored(id)).toMatchObject({ name: "Süpermarket", created_at: T0.toISOString(), updated_at: edited.toISOString() });
    const last = outbox().at(-1)!;
    // The whole row, never the changed column alone: the server may meet this
    // event before it has the row at all.
    expect(JSON.parse(last.payload)).toEqual(stored(id));
  });

  it("will not bring a deleted list back by renaming a stale copy", async () => {
    const id = await createList("Market");
    await deleteList(id);
    await expect(rename(id, "Pazar")).rejects.toThrow();
    expect(stored(id)).toMatchObject({ name: "Market", tombstone_version: 1 });
    expect(stored(id).deleted_at).not.toBeNull();
  });

  it("refuses an empty name and leaves the list as it was", async () => {
    const id = await createList("Market");
    await expect(rename(id, " ")).rejects.toThrow();
    expect(stored(id)).toMatchObject({ name: "Market" });
  });

  it("writes nothing when the name has not changed", async () => {
    const id = await createList("Market");
    vi.setSystemTime(new Date(T0.getTime() + 5000));
    await rename(id, "  Market ");
    expect(stored(id)).toMatchObject({ updated_at: T0.toISOString() });
    // An empty edit stamped as new would beat a real rename under last-writer-wins.
    expect(outbox()).toHaveLength(1);
  });

  it("replaces a queued event written in the same millisecond rather than dropping the newer one", async () => {
    const id = await createList("Market");
    await rename(id, "Pazar");
    const events = outbox();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.payload)).toMatchObject({ name: "Pazar" });
  });
});

describe("deleteList and restoreList", () => {
  it("tombstones the list and hands back what undo needs", async () => {
    const id = await createList("Market");
    const deleted = new Date(T0.getTime() + 1000);
    vi.setSystemTime(deleted);
    const snapshot = await deleteList(id);
    expect(snapshot).not.toBeNull();
    expect(stored(id)).toMatchObject({ deleted_at: deleted.toISOString(), tombstone_version: 1 });
    expect(outbox()).toHaveLength(2);
  });

  it("restores the list as it was, keeping the delete's generation", async () => {
    const id = await createList("Market");
    vi.setSystemTime(new Date(T0.getTime() + 1000));
    const snapshot = await deleteList(id);
    const restored = new Date(T0.getTime() + 2000);
    vi.setSystemTime(restored);
    await restoreList(snapshot!);
    expect(stored(id)).toMatchObject({
      name: "Market",
      created_at: T0.toISOString(),
      updated_at: restored.toISOString(),
      deleted_at: null,
      // Undo does not rewind the generation: a device still holding the
      // pre-delete row must lose to this one.
      tombstone_version: 1,
    });
    expect(await readLists()).toMatchObject([{ id, name: "Market" }]);
  });

  it("deletes what a rename queued before it left, so undo brings back the new name", async () => {
    const id = await createList("Market");
    // The queue is held, so the rename and the delete wait in line together.
    let release!: () => void;
    const held = withTransaction(() => new Promise<void>((done) => (release = done)));
    const renaming = rename(id, "Pazar");
    await nextTask();
    const removal = deleteList(id);
    await nextTask();
    release();
    await Promise.all([held, renaming]);
    const snapshot = await removal;
    expect(snapshot!.before[0]).toMatchObject({ name: "Pazar" });
    await restoreList(snapshot!);
    expect(stored(id)).toMatchObject({ name: "Pazar", deleted_at: null });
  });

  it("deletes once when asked twice at the same moment", async () => {
    const id = await createList("Market");
    const snapshots = await Promise.all([deleteList(id), deleteList(id)]);
    expect(snapshots.filter((snapshot) => snapshot != null)).toHaveLength(1);
    expect(stored(id)).toMatchObject({ tombstone_version: 1 });
  });

  it("answers null for a list that is not there", async () => {
    expect(await deleteList("01926d3e-0000-7000-8000-000000000000")).toBeNull();
  });

  it("will not restore over a list that is live again", async () => {
    const id = await createList("Market");
    const snapshot = await deleteList(id);
    await restoreList(snapshot!);
    await expect(restoreList(snapshot!)).rejects.toThrow();
  });

  it("counts a second delete as a new generation", async () => {
    const id = await createList("Market");
    await restoreList((await deleteList(id))!);
    await deleteList(id);
    expect(stored(id)).toMatchObject({ tombstone_version: 2 });
  });
});
