/** A list's items, and what the list screen can do to one. */

import { and, asc, count, desc, eq, isNull, max, sql, type SQL } from "drizzle-orm";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import {
  editRow,
  findLiveRow,
  fromDbShape,
  nowIso,
  readLiveRow,
  restoreRow,
  softDelete,
  writeRows,
  type RowSnapshot,
  type RowWrite,
} from "../db/mutations";
import { items, lists } from "../db/schema";
import { foldName, itemNameFrom, type Entry, type KnownProduct } from "../domain/items";

export interface Item extends Entry {
  id: string;
  checkedAt: string | null;
}

/** The basket's order, the latest tick first; everything a shop bought was ticked. */
function readItemsWhere(where: SQL | undefined): Promise<Item[]> {
  return getDb()
    .select({ id: items.id, name: items.name, quantityMilli: items.quantityMilli, unit: items.unit, checkedAt: items.checkedAt })
    .from(items)
    .where(and(where, isNull(items.deletedAt)))
    .orderBy(sql`${items.checkedAt} IS NOT NULL`, desc(items.checkedAt), asc(items.sortOrder), asc(items.id));
}

/** What is left to buy in its order, then the basket (SPEC 3.1). */
export function readItems(listId: string): Promise<Item[]> {
  return readItemsWhere(and(eq(items.listId, listId), isNull(items.shopId)));
}

/**
 * Every product on a live list, open or bought, one per folded name and
 * spelled as it was last written. A deleted item or list is not something the
 * household has.
 */
export async function readKnownProducts(): Promise<KnownProduct[]> {
  const rows = await getDb()
    .select({ name: items.name, times: count() })
    .from(items)
    .innerJoin(lists, and(eq(lists.id, items.listId), isNull(lists.deletedAt)))
    .where(isNull(items.deletedAt))
    .groupBy(items.name)
    // One entry writes its items with one stamp; the name keeps their order fixed.
    .orderBy(desc(max(items.updatedAt)), asc(items.name));
  const known = new Map<string, KnownProduct>();
  // The latest first, so a product keeps the spelling it was last written in,
  // and the list stays in the order `suggestProducts` settles a tie by.
  for (const row of rows) {
    const key = foldName(row.name);
    const held = known.get(key);
    if (held) held.times += row.times;
    else known.set(key, { key, name: row.name, times: row.times });
  }
  return [...known.values()];
}

export function readShopItems(shopId: string): Promise<Item[]> {
  return readItemsWhere(eq(items.shopId, shopId));
}

/** A product's row on a list: bought and needed again, it comes back under the same id. */
export function openItemId(listId: string, name: string): Promise<string> {
  return deterministicId(naturalKeys.openItem(listId, foldName(name)));
}

/**
 * Add what the quick-add field, a suggestion or a shop's history names (SPEC
 * 2.1–2.5, 3.5) and return the ids of its rows. A product already on the list
 * is merged into its row rather than added again, and one deleted from it, or
 * bought, comes back on top.
 */
export async function addEntries(listId: string, added: readonly Entry[]): Promise<string[]> {
  const entries = new Map<string, Entry>();
  const ids = await Promise.all(added.map((entry) => openItemId(listId, entry.name)));
  // Only an entry's own fields: an item from history also carries its id and tick.
  added.forEach(({ name, quantityMilli, unit }, at) => {
    const id = ids[at]!;
    const held = entries.get(id);
    // Named twice, a product keeps its first place and the last quantity given.
    if (!held) entries.set(id, { name, quantityMilli, unit });
    else if (quantityMilli != null) entries.set(id, { ...held, quantityMilli, unit });
  });
  if (entries.size === 0) return [];

  const sqlite = await getSqliteAsync();
  await writeRows(async () => {
    await readLiveRow("lists", listId);
    const top = await sqlite.getFirstAsync<{ low: number | null }>(
      "SELECT MIN(sort_order) AS low FROM items WHERE list_id = ? AND shop_id IS NULL AND deleted_at IS NULL",
      [listId],
    );
    const unique = [...entries.keys()];
    const live = new Map(
      (
        await sqlite.getAllAsync<RowSnapshot>(
          `SELECT * FROM items WHERE id IN (${unique.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
          unique,
        )
      ).map((row) => [row.id, row]),
    );
    let sortOrder = (top?.low ?? 0) - entries.size;
    const writes: RowWrite[] = [];
    for (const [id, entry] of entries) {
      const stored = live.get(id);
      if (!stored) writes.push({ table: "items", row: { id, listId, ...entry, sortOrder: sortOrder++, checkedAt: null, deletedAt: null } });
      // Already there, the row keeps its name and place and takes a quantity named again.
      else if (entry.quantityMilli != null) writes.push(...editRow("items", stored, { quantityMilli: entry.quantityMilli, unit: entry.unit }));
    }
    return writes;
  });
  return [...entries.keys()];
}

/** A stale screen must not edit an item whose list is gone, nor make one under it. */
async function readLiveItem(id: string): Promise<RowSnapshot> {
  const stored = await readLiveRow("items", id);
  await readLiveRow("lists", String(stored.list_id));
  return stored;
}

/**
 * Tick an item into the basket or take it back out (SPEC 3.1). The tick is
 * read inside the write, so a second tap before the screen has refreshed takes
 * it back rather than repeating it.
 */
export function toggleChecked(id: string): Promise<void> {
  return writeRows(async () => {
    const stored = await readLiveItem(id);
    return editRow("items", stored, { checkedAt: stored.checked_at == null ? nowIso() : null });
  });
}

/**
 * Save the item panel: its name and quantity, in one write. The id is the
 * product's, so a new product means a new row: the old one is tombstoned and
 * the new one carries everything else, or merges into the product's row when
 * it is already there. Renamed in place, "süt" → "ayran" would leave the row
 * where the next "süt" lands, and that "süt" would overwrite the ayran.
 */
export async function updateItem(id: string, entry: Entry): Promise<void> {
  const name = itemNameFrom(entry.name);
  if (name == null) throw new Error("An item needs a name");
  await writeRows(async () => {
    const stored = await readLiveItem(id);
    const quantity = { quantityMilli: entry.quantityMilli, unit: entry.unit };
    const target = await openItemId(String(stored.list_id), name);
    if (target === id) return editRow("items", stored, { name, ...quantity });
    const row = fromDbShape("items", stored);
    const gone: RowWrite = { table: "items", row: { ...row, deletedAt: nowIso() } };
    // Onto a product already on the list, the save lands as adding it again
    // would (2.5): that row keeps its name, place and tick, and takes a quantity.
    const there = await findLiveRow("items", target);
    if (there) return [gone, ...(quantity.quantityMilli == null ? [] : editRow("items", there, quantity))];
    return [gone, { table: "items", row: { ...row, name, ...quantity, id: target, deletedAt: null, tombstoneVersion: 0 } }];
  });
}

/** Returns what undo needs, or `null` when the item was already gone. */
export function deleteItem(id: string): Promise<RowSnapshot | null> {
  return softDelete("items", id);
}

export function restoreItem(snapshot: RowSnapshot): Promise<void> {
  return restoreRow("items", snapshot);
}
