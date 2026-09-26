/** A list's items, and what the list screen can do to one. */

import { and, asc, count, desc, eq, isNotNull, isNull, max, ne, sql, type SQL } from "drizzle-orm";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import {
  editRow,
  findLiveRow,
  fromDbShape,
  nowIso,
  deleteRow,
  readLiveRow,
  revertRows,
  writeRows,
  writeUndoable,
  type RowSnapshot,
  type RowWrite,
  type RowsWritten,
} from "../db/mutations";
import { items, lists, photos } from "../db/schema";
import { bareEntry, foldName, itemNameFrom, noteFrom, type Entry, type ItemChange, type KnownProduct, type ListedEntry } from "../domain/items";
import { isPrice, type Bought } from "../domain/money";
import { photoColumn, type PhotoChange } from "./photos";

export interface Item extends ItemChange {
  id: string;
  checkedAt: string | null;
  photoId: string | null;
  /** The photo's thumbnail, or `null` with none on this device. */
  photo: string | null;
}

/** The item panel's save: what an item holds, and what happens to its photo. */
export type ItemSave = ItemChange & { photo?: PhotoChange };

/**
 * What is still to find, urgent first, then what was not found; the basket
 * after, the latest tick first. Everything a shop bought was ticked.
 */
function readItemsWhere(where: SQL | undefined): Promise<Item[]> {
  return getDb()
    .select({
      id: items.id,
      name: items.name,
      quantityMilli: items.quantityMilli,
      unit: items.unit,
      note: items.note,
      urgent: items.urgent,
      notFound: items.notFound,
      boughtInstead: items.boughtInstead,
      priceMinor: items.priceMinor,
      checkedAt: items.checkedAt,
      photoId: items.photoId,
      photo: photos.thumb,
    })
    .from(items)
    .leftJoin(photos, eq(photos.id, items.photoId))
    .where(and(where, isNull(items.deletedAt)))
    .orderBy(
      sql`${items.checkedAt} IS NOT NULL`,
      desc(items.checkedAt),
      asc(items.notFound),
      desc(items.urgent),
      asc(items.sortOrder),
      asc(items.id),
    );
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
  // A substitute is what came home, so it is the product counted and offered.
  const product = sql<string>`coalesce(${items.boughtInstead}, ${items.name})`;
  const rows = await getDb()
    .select({ name: product, times: count() })
    .from(items)
    .innerJoin(lists, and(eq(lists.id, items.listId), isNull(lists.deletedAt)))
    .where(isNull(items.deletedAt))
    .groupBy(product)
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

/**
 * Everything bought on a live list, in history or still in a basket, priced
 * or not, latest first: when a product was last bought (3.9) and what it
 * usually costs (3.12). The item in the panel is left out, or its own price,
 * saved once, would be what it is measured against.
 */
export async function readBought(exceptId: string): Promise<Bought[]> {
  const rows = await getDb()
    .select({ name: items.name, quantityMilli: items.quantityMilli, unit: items.unit, priceMinor: items.priceMinor, boughtAt: items.checkedAt })
    .from(items)
    .innerJoin(lists, and(eq(lists.id, items.listId), isNull(lists.deletedAt)))
    .where(and(isNull(items.deletedAt), isNotNull(items.checkedAt), ne(items.id, exceptId)))
    .orderBy(desc(items.checkedAt), asc(items.id));
  return rows.flatMap((row) => (row.boughtAt == null ? [] : [{ ...row, boughtAt: row.boughtAt }]));
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
  // An item from history also carries its id and tick, and the note and
  // urgency a product added again comes back without.
  const entries = await byProduct(listId, added.map(bareEntry));
  if (entries.size > 0) await writeRows(() => landEntries(listId, entries));
  return [...entries.keys()];
}

/**
 * Add a scanned product (SPEC 2.8) as adding its name would, with its brand
 * as the note and its picture as the photo, in one write.
 */
export async function addScanned(listId: string, scanned: { name: string; note: string | null; photo: PhotoChange }): Promise<string> {
  const name = itemNameFrom(scanned.name);
  if (name == null) throw new Error("An item needs a name");
  const id = await openItemId(listId, name);
  const entry = { name, quantityMilli: null, unit: null, note: noteFrom(scanned.note), urgent: false };
  await writeRows(async () => {
    const { photoId } = await photoColumn(scanned.photo);
    return landEntries(listId, new Map([[id, { ...entry, photoId }]]));
  });
  return id;
}

/**
 * Add a pasted list (SPEC 6.2) as `addEntries` adds an entry, each item with
 * its note and urgency, in one write the undo bar takes back whole
 * (`undoSave`). `null` when it changes nothing: it names no product, or only
 * what the list already has as it is.
 */
export async function importEntries(listId: string, added: readonly ListedEntry[]): Promise<RowsWritten | null> {
  const entries = await byProduct(listId, added);
  if (entries.size === 0) return null;
  const written = await writeUndoable(() => landEntries(listId, entries));
  return written.writes.length === 0 ? null : written;
}

/** What adding `added` writes, for a write that adds to a list among other things; run inside it. */
export async function entryRows(listId: string, added: readonly ListedEntry[]): Promise<RowWrite[]> {
  return landEntries(listId, await byProduct(listId, added));
}

/** One per product: named twice, it keeps its first place and takes the last quantity and note given. */
async function byProduct(listId: string, added: readonly ListedEntry[]): Promise<Map<string, ListedEntry>> {
  const ids = await Promise.all(added.map((entry) => openItemId(listId, entry.name)));
  const entries = new Map<string, ListedEntry>();
  added.forEach((entry, at) => {
    const id = ids[at]!;
    const held = entries.get(id);
    const quantity = entry.quantityMilli == null && held ? held : entry;
    entries.set(id, {
      ...(held ?? entry),
      quantityMilli: quantity.quantityMilli,
      unit: quantity.unit,
      note: entry.note ?? held?.note ?? null,
      urgent: entry.urgent || held?.urgent === true,
    });
  });
  return entries;
}

async function landEntries(listId: string, entries: ReadonlyMap<string, ListedEntry>): Promise<RowWrite[]> {
  await readLiveRow("lists", listId);
  const unique = [...entries.keys()];
  const sqlite = await getSqliteAsync();
  const live = new Map(
    (
      await sqlite.getAllAsync<RowSnapshot>(
        `SELECT * FROM items WHERE id IN (${unique.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
        unique,
      )
    ).map((row) => [row.id, row]),
  );
  let sortOrder = (await topPlace(listId)) - entries.size;
  const writes: RowWrite[] = [];
  for (const [id, entry] of entries) {
    writes.push(...land(id, live.get(id) ?? null, { listId, ...entry, sortOrder: sortOrder++, checkedAt: null }));
  }
  return writes;
}

/** The place of what is on top of a list's open items; what lands goes above it. */
async function topPlace(listId: string): Promise<number> {
  const sqlite = await getSqliteAsync();
  const top = await sqlite.getFirstAsync<{ low: number | null }>(
    "SELECT MIN(sort_order) AS low FROM items WHERE list_id = ? AND shop_id IS NULL AND deleted_at IS NULL",
    [listId],
  );
  return top?.low ?? 0;
}

/** A stale screen must not edit an item whose list is gone, nor make one under it. */
async function readLiveItem(id: string): Promise<RowSnapshot> {
  const stored = await readLiveRow("items", id);
  await readLiveRow("lists", String(stored.list_id));
  return stored;
}

/**
 * An item as it is written, whatever the path: what was bought instead, or
 * paid for, was bought, so it is in the basket, and what is in the basket was
 * found (SPEC 3.7, 3.8).
 */
function settled(row: Record<string, unknown>): Record<string, unknown> {
  const bought = row.boughtInstead != null || row.priceMinor != null;
  const checkedAt = bought ? (row.checkedAt ?? nowIso()) : row.checkedAt;
  return { ...row, checkedAt, notFound: checkedAt == null && row.notFound === true };
}

function editItem(stored: RowSnapshot, patch: Record<string, unknown>): RowWrite[] {
  return editRow("items", stored, settled({ ...fromDbShape("items", stored), ...patch }));
}

/**
 * An item arriving under a product's id, whether added, renamed or moved.
 * Onto the product's live row it lands as adding it again would (2.5): that
 * row keeps its name, place and tick, and takes whatever the arriving item
 * has, keeping its own where the item has none. With no live row there, the
 * arriving item is the row, new or back.
 */
function land(id: string, there: RowSnapshot | null, arriving: Record<string, unknown>): RowWrite[] {
  if (!there) return [{ table: "items", row: settled({ ...arriving, id, deletedAt: null }) }];
  return editItem(there, {
    ...(arriving.quantityMilli != null && { quantityMilli: arriving.quantityMilli, unit: arriving.unit }),
    ...(arriving.note != null && { note: arriving.note }),
    ...(arriving.urgent === true && { urgent: true }),
    ...(arriving.notFound === true && { notFound: true }),
    ...(arriving.boughtInstead != null && { boughtInstead: arriving.boughtInstead }),
    ...(arriving.priceMinor != null && { priceMinor: arriving.priceMinor }),
    ...(arriving.photoId != null && { photoId: arriving.photoId }),
  });
}

/**
 * Tick an item into the basket or take it back out (SPEC 3.1). The tick is
 * read inside the write, so a second tap before the screen has refreshed takes
 * it back rather than repeating it. Taken back out, what was bought in its
 * place, and what was paid, was not after all.
 */
export function toggleChecked(id: string): Promise<void> {
  return writeRows(async () => {
    const stored = await readLiveItem(id);
    return editItem(stored, stored.checked_at == null ? { checkedAt: nowIso() } : { checkedAt: null, boughtInstead: null, priceMinor: null });
  });
}

/**
 * What is left to buy, in the order it was dragged into (SPEC 4.1): each open
 * item takes its position as its place. Read inside the write, an item ticked,
 * deleted or sent elsewhere during the drag keeps its own; one added during it
 * is not in the order and keeps the place it landed on, above the rest.
 */
export function reorderItems(listId: string, orderedIds: readonly string[]): Promise<void> {
  return writeRows(async () => {
    const sqlite = await getSqliteAsync();
    const open = new Map(
      (
        await sqlite.getAllAsync<RowSnapshot>(
          "SELECT * FROM items WHERE list_id = ? AND shop_id IS NULL AND checked_at IS NULL AND deleted_at IS NULL",
          [listId],
        )
      ).map((row) => [row.id, row]),
    );
    return orderedIds.flatMap((id, place) => {
      const stored = open.get(id);
      return stored ? editItem(stored, { sortOrder: place }) : [];
    });
  });
}

/**
 * Save the item panel: its name, quantity, note, urgency, whether it was not
 * found or something else was bought instead, and what was paid, in one
 * write. What was bought instead or paid for was bought, so it goes into the
 * basket (SPEC 3.7, 3.8). The id is the
 * product's, so a new product means a new row: the old one is tombstoned and
 * the new one carries everything else, or merges into the product's row when
 * it is already there. Renamed in place, "süt" → "ayran" would leave the row
 * where the next "süt" lands, and that "süt" would overwrite the ayran.
 *
 * With `to`, the same write sends the item to another list, or with `keep` a
 * copy of it (SPEC 4.3). It lands as adding it there would, with its name,
 * quantity, note and urgency: a new row goes on top, to buy. Its tick, what
 * was or was not found and its price belong to this list's shop and do not go.
 */
export async function updateItem(
  id: string,
  change: ItemSave,
  to?: { listId: string; keep: boolean },
): Promise<{ name: string; written: RowsWritten }> {
  const name = itemNameFrom(change.name);
  if (name == null) throw new Error("An item needs a name");
  const note = noteFrom(change.note);
  const boughtInstead = change.boughtInstead == null ? null : itemNameFrom(change.boughtInstead);
  const { priceMinor } = change;
  if (priceMinor != null && !isPrice(priceMinor)) throw new Error("A price is whole kuruş");
  const saved = { name, quantityMilli: change.quantityMilli, unit: change.unit, note, urgent: change.urgent, notFound: change.notFound, boughtInstead, priceMinor };
  const written = await writeUndoable(async () => {
    const stored = await readLiveItem(id);
    const { photoId = stored.photo_id as string | null } = await photoColumn(change.photo);
    const here = !to || to.keep ? await saveHere(stored, { ...saved, photoId }) : editRow("items", stored, { deletedAt: nowIso() });
    if (!to) return here;
    if (to.listId === stored.list_id) throw new Error("An item is sent to another list");
    await readLiveRow("lists", to.listId);
    const target = await openItemId(to.listId, name);
    const { quantityMilli, unit, urgent } = saved;
    return [
      ...here,
      ...land(target, await findLiveRow("items", target), {
        listId: to.listId,
        name,
        quantityMilli,
        unit,
        note,
        urgent,
        photoId,
        sortOrder: (await topPlace(to.listId)) - 1,
        checkedAt: null,
      }),
    ];
  });
  return { name, written };
}

async function saveHere(stored: RowSnapshot, saved: Record<string, unknown>): Promise<RowWrite[]> {
  const target = await openItemId(String(stored.list_id), String(saved.name));
  if (target === stored.id) return editItem(stored, saved);
  return [
    ...editRow("items", stored, { deletedAt: nowIso() }),
    ...land(target, await findLiveRow("items", target), { ...fromDbShape("items", stored), ...saved, tombstoneVersion: 0 }),
  ];
}

/** Take back a save that sent an item elsewhere, or a paste, unless the list is gone. */
export function undoSave(written: RowsWritten, listId: string): Promise<void> {
  return revertRows(written, () => readLiveRow("lists", listId));
}

/** Returns what undo needs, or `null` when the item was already gone. */
export function deleteItem(id: string): Promise<RowsWritten | null> {
  return deleteRow("items", id);
}

export { undoRows as restoreItem } from "../db/mutations";

