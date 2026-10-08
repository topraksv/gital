/**
 * Finished shops (SPEC 3.4, 3.5). History is not a table of its own
 * (`docs/ARCHITECTURE.md`, Tables): finishing writes a shop and moves each
 * bought item to a row of its own under it, and history reads those rows.
 */

import { and, asc, count, desc, eq, gte, isNotNull, isNull, sum } from "drizzle-orm";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { editRow, fromDbShape, nowIso, readLiveRow, actingUser, writeRows, type RowSnapshot, type RowWrite } from "../db/mutations";
import { items, lists, photos, shops } from "../db/schema";
import { foldName } from "../domain/items";
import { isPrice, spentOn } from "../domain/money";
import { lookOf, type ListLook } from "../domain/lists";
import type { Purchase } from "../domain/restock";
import { openItemId } from "./items";
import { arrivalRows, arrivalsOf, boughtEntry } from "./pantry";
import { photoColumn, type NewPhoto } from "./photos";

/** A shop wears its list's colour and picture (SPEC 1.8). */
export interface Shop extends Omit<ListLook, "name"> {
  id: string;
  listId: string;
  listName: string;
  finishedAt: string;
  bought: number;
  /**
   * What it cost in kuruş (SPEC 3.8): the receipt's total when one was typed,
   * else what its priced items add up to; `null` when neither, which is not ₺0.
   */
  spentMinor: number | null;
  /** The two it is taken from: the total typed, and the sum of the prices. */
  totalMinor: number | null;
  summedMinor: number | null;
  /** The receipt's photo, and its thumbnail once it has reached this device. */
  receiptId: string | null;
  receipt: string | null;
}

/** What this list's shops bought, the latest first: the rhythm 2.7's suggestion reads. */
export function readPurchases(listId: string): Promise<Purchase[]> {
  return getDb()
    .select({ name: items.name, quantityMilli: items.quantityMilli, unit: items.unit, boughtAt: shops.finishedAt })
    .from(items)
    .innerJoin(shops, and(eq(shops.id, items.shopId), eq(shops.listId, items.listId), isNull(shops.deletedAt)))
    .where(and(eq(shops.listId, listId), isNull(items.deletedAt)))
    .orderBy(desc(shops.finishedAt), asc(items.id));
}

/** Every list's shops, the latest first. A deleted list's history goes with it. */
export async function readShops(): Promise<Shop[]> {
  const rows = await getDb()
    .select({
      id: shops.id,
      listId: shops.listId,
      listName: lists.name,
      color: lists.color,
      icon: lists.icon,
      finishedAt: shops.finishedAt,
      bought: count(items.id),
      totalMinor: shops.totalMinor,
      receiptId: shops.photoId,
      receipt: photos.thumb,
      // SUM is NULL over no prices, as `spentOn` is; the mapping skips NULL.
      summedMinor: sum(items.priceMinor).mapWith(Number),
    })
    .from(shops)
    .innerJoin(lists, and(eq(lists.id, shops.listId), isNull(lists.deletedAt)))
    // The same list too: a shop id is a hash of its list's, so a co-member can name another list's shop on a row of theirs.
    .leftJoin(items, and(eq(items.shopId, shops.id), eq(items.listId, shops.listId), isNull(items.deletedAt)))
    .leftJoin(photos, eq(photos.id, shops.photoId))
    .where(isNull(shops.deletedAt))
    .groupBy(shops.id)
    .orderBy(desc(shops.finishedAt), desc(shops.id));
  return rows.map((row) => ({ ...lookOf(row), spentMinor: row.totalMinor ?? row.summedMinor }));
}

/** What shops finished since `since` bought with a price, for the month's aisle shares (SPEC 3.9). */
export async function readPricedSince(since: string): Promise<{ name: string; priceMinor: number }[]> {
  const rows = await getDb()
    .select({ name: items.name, priceMinor: items.priceMinor })
    .from(items)
    .innerJoin(shops, and(eq(shops.id, items.shopId), eq(shops.listId, items.listId), isNull(shops.deletedAt), gte(shops.finishedAt, since)))
    .innerJoin(lists, and(eq(lists.id, shops.listId), isNull(lists.deletedAt)))
    .where(and(isNull(items.deletedAt), isNotNull(items.priceMinor)));
  return rows.map(({ name, priceMinor }) => ({ name, priceMinor: priceMinor! }));
}

/** Correct a shop's total to its receipt, or with `null` go back to the sum of its prices. */
export async function setShopTotal(shopId: string, totalMinor: number | null): Promise<void> {
  if (totalMinor != null && !isPrice(totalMinor)) throw new Error("A total is whole kuruş");
  await writeRows(async () => {
    const shop = await readLiveRow("shops", shopId);
    await readLiveRow("lists", String(shop.list_id));
    return editRow("shops", shop, { totalMinor });
  });
}

/** The receipt's photo on a finished shop, or with `null` taken off. */
export async function setShopReceipt(shopId: string, change: NewPhoto | null): Promise<void> {
  await writeRows(async () => {
    const shop = await readLiveRow("shops", shopId);
    await readLiveRow("lists", String(shop.list_id));
    return editRow("shops", shop, await photoColumn(change));
  });
}

/**
 * The highest live shop number rather than a count: after an undo of a shop
 * that was not the last, a count would give the next shop a number, and so
 * an id, already taken.
 */
async function lastShopNumber(listId: string): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ last: number | null }>(
    "SELECT MAX(number) AS last FROM shops WHERE list_id = ? AND deleted_at IS NULL",
    [listId],
  );
  return row?.last ?? 0;
}

/**
 * Finish the list's shop: each item in the basket leaves the list for a row
 * under the next shop, and what was not bought stays. `null` when the basket
 * was empty.
 *
 * Moved rather than stamped in place: the list's row is tombstoned, so an
 * edit from a screen, or later a device, that has not seen the finish meets
 * a tombstone, which every edit refuses and sync's delete generation settles,
 * instead of taking the item back out of history with a whole-row write.
 * `stocked` is how many went to the pantry (SPEC 12.5), for the celebration:
 * this person's ticks only, since a pantry is its owner's to write, and each
 * other member's device brings theirs home (`settleArrivals`). `stayed` is
 * what the shop left on the list, and `spentMinor` what it paid, both read
 * inside the same write: a tick that lands as Bitir is pressed is bought,
 * which the screen's snapshot was not.
 */
type FinishedShop = { id: string; bought: number; spentMinor: number | null; stocked: number; stayed: string[] };

export async function finishShop(listId: string): Promise<FinishedShop | null> {
  const sqlite = await getSqliteAsync();
  let finished: FinishedShop | null = null;
  await writeRows(async () => {
    const list = fromDbShape("lists", await readLiveRow("lists", listId));
    const bought = await sqlite.getAllAsync<RowSnapshot>(
      "SELECT * FROM items WHERE list_id = ? AND shop_id IS NULL AND checked_at IS NOT NULL AND deleted_at IS NULL",
      [listId],
    );
    if (bought.length === 0) return [];
    const number = (await lastShopNumber(listId)) + 1;
    const id = await deterministicId(naturalKeys.shop(listId, number));
    const now = nowIso();
    // A tick made with nobody signed in is this device's person's too.
    const mine = (row: RowSnapshot) => row.checked_by == null || row.checked_by === actingUser();
    const home = list.pantry === true ? bought.flatMap((row, at) => (mine(row) ? [at] : [])) : [];
    const stayed = await sqlite.getAllAsync<{ id: string }>(
      "SELECT id FROM items WHERE list_id = ? AND shop_id IS NULL AND checked_at IS NULL AND deleted_at IS NULL",
      [listId],
    );
    const copies = await Promise.all(
      bought.map(async (row) => ({
        ...fromDbShape("items", row),
        id: await deterministicId(naturalKeys.boughtItem(id, foldName(String(row.name)))),
        shopId: id,
        tombstoneVersion: 0,
      })),
    );
    finished = { id, bought: bought.length, spentMinor: spentOn(bought.map((row) => ({ priceMinor: row.price_minor as number | null }))), stocked: home.length, stayed: stayed.map((row) => row.id) };
    const moves = bought.map((row, at): RowWrite[] => [...editRow("items", row, { deletedAt: now }), { table: "items", row: copies[at]! }]);
    // What was bought comes home in the same write, unless the list's switch says not (SPEC 12.5).
    const arrivals = await arrivalRows(
      listId,
      home.map((at) => boughtEntry({ ...bought[at]!, id: copies[at]!.id })),
    );
    // An undone shop finished again is the same rows, brought back, summed
    // afresh rather than wearing the total typed before. The shop goes last: Geçmiş re-reads on a shop's change and not on an item's, so
    // its read must not start before the items are written.
    return [...moves.flat(), ...arrivals, { table: "shops", row: { id, listId, number, finishedAt: now, totalMinor: null, deletedAt: null } }];
  });
  return finished;
}

/**
 * Undo a finish: the shop and its rows are tombstoned, and each product goes
 * back to the basket as it was — unless it was added again meanwhile, when the
 * list already holds it and keeps what is there.
 */
export async function reopenShop(shopId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  await writeRows(async () => {
    const shop = await readLiveRow("shops", shopId);
    const listId = String(shop.list_id);
    await readLiveRow("lists", listId);
    const now = nowIso();
    const moved = await sqlite.getAllAsync<RowSnapshot>("SELECT * FROM items WHERE shop_id = ? AND list_id = ? AND deleted_at IS NULL", [shopId, listId]);
    const ids = await Promise.all(moved.map((row) => openItemId(listId, String(row.name))));
    const gone = await sqlite.getAllAsync<RowSnapshot>(
      `SELECT * FROM items WHERE id IN (${ids.map(() => "?").join(", ")}) AND deleted_at IS NOT NULL`,
      ids,
    );
    return [
      ...moved.flatMap((row) => editRow("items", row, { deletedAt: now })),
      ...gone.flatMap((row) => editRow("items", row, { deletedAt: null })),
      ...(await arrivalsOf(moved.map((row) => String(row.id)), now)),
      // Last, as in `finishShop`.
      ...editRow("shops", shop, { deletedAt: now }),
    ];
  });
}
