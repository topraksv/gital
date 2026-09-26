/**
 * Finished shops (SPEC 3.4, 3.5). History is not a table of its own
 * (`docs/ARCHITECTURE.md`, Tables): finishing writes a shop and moves each
 * bought item to a row of its own under it, and history reads those rows.
 */

import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { editRow, fromDbShape, nowIso, readLiveRow, writeRows, type RowSnapshot, type RowWrite } from "../db/mutations";
import { items, lists, shops } from "../db/schema";
import { foldName } from "../domain/items";
import { lookOf, type ListLook } from "../domain/lists";
import { openItemId } from "./items";

/** A shop wears its list's colour and picture (SPEC 1.8). */
export interface Shop extends Omit<ListLook, "name"> {
  id: string;
  listId: string;
  listName: string;
  finishedAt: string;
  bought: number;
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
    })
    .from(shops)
    .innerJoin(lists, and(eq(lists.id, shops.listId), isNull(lists.deletedAt)))
    .leftJoin(items, and(eq(items.shopId, shops.id), isNull(items.deletedAt)))
    .where(isNull(shops.deletedAt))
    .groupBy(shops.id)
    .orderBy(desc(shops.finishedAt), desc(shops.id));
  return rows.map(lookOf);
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
 */
export async function finishShop(listId: string): Promise<{ id: string; bought: number } | null> {
  const sqlite = await getSqliteAsync();
  let finished: { id: string; bought: number } | null = null;
  await writeRows(async () => {
    await readLiveRow("lists", listId);
    const bought = await sqlite.getAllAsync<RowSnapshot>(
      "SELECT * FROM items WHERE list_id = ? AND shop_id IS NULL AND checked_at IS NOT NULL AND deleted_at IS NULL",
      [listId],
    );
    if (bought.length === 0) return [];
    const number = (await lastShopNumber(listId)) + 1;
    const id = await deterministicId(naturalKeys.shop(listId, number));
    const now = nowIso();
    finished = { id, bought: bought.length };
    const moves = await Promise.all(
      bought.map(async (row): Promise<RowWrite[]> => [
        ...editRow("items", row, { deletedAt: now }),
        {
          table: "items",
          row: {
            ...fromDbShape("items", row),
            id: await deterministicId(naturalKeys.boughtItem(id, foldName(String(row.name)))),
            shopId: id,
            tombstoneVersion: 0,
          },
        },
      ]),
    );
    // An undone shop finished again is the same rows, brought back. The shop
    // goes last: Geçmiş re-reads on a shop's change and not on an item's, so
    // its read must not start before the items are written.
    return [...moves.flat(), { table: "shops", row: { id, listId, number, finishedAt: now, deletedAt: null } }];
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
    const moved = await sqlite.getAllAsync<RowSnapshot>("SELECT * FROM items WHERE shop_id = ? AND deleted_at IS NULL", [shopId]);
    const ids = await Promise.all(moved.map((row) => openItemId(listId, String(row.name))));
    const gone = await sqlite.getAllAsync<RowSnapshot>(
      `SELECT * FROM items WHERE id IN (${ids.map(() => "?").join(", ")}) AND deleted_at IS NOT NULL`,
      ids,
    );
    return [
      ...moved.flatMap((row) => editRow("items", row, { deletedAt: now })),
      ...gone.flatMap((row) => editRow("items", row, { deletedAt: null })),
      // Last, as in `finishShop`.
      ...editRow("shops", shop, { deletedAt: now }),
    ];
  });
}
