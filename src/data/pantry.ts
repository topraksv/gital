/** The pantry (SPEC 12.2, 12.8): what is at home, filled by finished shops and emptied by hand. */

import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { editRow, findLiveRow, findRow, nowIso, readLiveRow, writeRows, writeUndoable, type RowSnapshot, type RowWrite, type RowsWritten } from "../db/mutations";
import { lists, pantryItems, pantryMoves } from "../db/schema";
import { isISODate, type ISODate } from "../domain/dates";
import { foldName, quantityOrOne, type Entry, type Unit } from "../domain/items";
import { lastedOf, lessOf, stockOf, type Stock } from "../domain/pantry";
import { entryRows } from "./items";
import { viewing } from "./lists";

export interface PantryItem extends Stock {
  id: string;
  name: string;
  /** The list its last shop came from, where finishing it puts it back. */
  listId: string | null;
  expiresOn: ISODate | null;
  sortOrder: number;
}

/**
 * The Kiler this device holds (SPEC 12.13): a `sync_state` row `pantry:<id>`,
 * written when it last changed Kiler, with when. None is the person's own,
 * held since always.
 */
export const HELD_PANTRY = "pantry:";

export async function heldPantry(userId: string): Promise<{ id: string; since: string | null }> {
  const sqlite = await getSqliteAsync();
  const held = await sqlite.getFirstAsync<{ table_name: string; last_pulled_at: string }>(
    "SELECT table_name, last_pulled_at FROM sync_state WHERE table_name LIKE ?",
    [`${HELD_PANTRY}%`],
  );
  return held ? { id: held.table_name.slice(HELD_PANTRY.length), since: held.last_pulled_at } : { id: userId, since: null };
}

/** A product finished, for the undo bar: the list it went back on, if that list is still there. */
export interface Finished {
  written: RowsWritten;
  listName: string | null;
}

type Held = Pick<PantryItem, "name" | "listId" | "expiresOn" | "sortOrder"> & { moves: (Stock & { at: string })[] };

/** Each pantry row's moves, oldest first. */
async function readMoves(where = isNull(pantryItems.deletedAt)): Promise<Map<string, Held>> {
  const rows = await getDb()
    .select({
      id: pantryItems.id,
      name: pantryItems.name,
      listId: pantryItems.listId,
      expiresOn: pantryItems.expiresOn,
      sortOrder: pantryItems.sortOrder,
      quantityMilli: pantryMoves.quantityMilli,
      unit: pantryMoves.unit,
      at: pantryMoves.createdAt,
    })
    .from(pantryItems)
    .innerJoin(pantryMoves, and(eq(pantryMoves.pantryItemId, pantryItems.id), isNull(pantryMoves.deletedAt)))
    .where(where)
    .orderBy(asc(pantryMoves.createdAt), asc(pantryMoves.id));
  const moves = new Map<string, Held>();
  for (const { id, name, listId, expiresOn, sortOrder, ...move } of rows) {
    const held = moves.get(id) ?? { name, listId, expiresOn, sortOrder, moves: [] };
    held.moves.push(move);
    moves.set(id, held);
  }
  return moves;
}

async function readStocks(where?: SQL): Promise<Map<string, PantryItem>> {
  const stocks = new Map<string, PantryItem>();
  for (const [id, { moves: all, ...held }] of await readMoves(where)) {
    const stock = stockOf(all);
    if (stock) stocks.set(id, { id, ...held, quantityMilli: stock.quantityMilli, unit: stock.unit });
  }
  return stocks;
}

/**
 * How long each product stayed at home, by folded name, for the restock
 * rhythm (SPEC 12.7). Pairs rather than a map, because a live store holds a list.
 */
export async function readLasted(): Promise<[string, number[]][]> {
  return [...(await readMoves()).values()].map(({ name, moves }) => [foldName(name), lastedOf(moves)]);
}

/** What is at home, in its dragged order and otherwise by name; a product used up is not. */
export async function readPantry(): Promise<PantryItem[]> {
  return [...(await readStocks()).values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
}

/**
 * Kiler in the order it was dragged into (SPEC 4.1, as a list's): each product
 * takes its place. One finished during the drag keeps its own.
 */
export function reorderPantry(orderedIds: readonly string[]): Promise<void> {
  return writeRows(async () => {
    const home = await readStocks();
    const writes: RowWrite[] = [];
    for (const [place, id] of orderedIds.entries()) {
      if (home.has(id)) writes.push(...editRow("pantry_items", await readLiveRow("pantry_items", id), { sortOrder: place }));
    }
    return writes;
  });
}

/**
 * A product's pantry row brought back to life, or made: one per folded name.
 * `listId` given is where it now comes from; left out, an existing row keeps
 * the list its last shop came from.
 */
async function pantryItemRows(name: string, change: { listId?: string }): Promise<{ pantryItemId: string; rows: RowWrite[] }> {
  const pantryItemId = await deterministicId(naturalKeys.pantryItem(foldName(name)));
  const there = await findRow("pantry_items", pantryItemId);
  return {
    pantryItemId,
    rows: there
      ? editRow("pantry_items", there, { ...change, deletedAt: null })
      : [{ table: "pantry_items", row: { id: pantryItemId, name, listId: change.listId ?? null, deletedAt: null } }],
  };
}

/**
 * What a shop's bought items bring home (SPEC 12.5): an arrival each, in the
 * pantry row of its product, which now comes from this list. Written in the
 * finish's own transaction.
 */
export async function arrivalRows(
  listId: string,
  bought: readonly ({ id: string } & Entry)[],
): Promise<RowWrite[]> {
  const writes: RowWrite[] = [];
  for (const item of bought) {
    const { pantryItemId, rows } = await pantryItemRows(item.name, { listId });
    writes.push(
      ...rows,
      {
        table: "pantry_moves",
        row: { id: await deterministicId(naturalKeys.arrival(item.id)), pantryItemId, ...quantityOrOne(item), deletedAt: null, tombstoneVersion: 0 },
      },
    );
  }
  return writes;
}

/**
 * What was at home before Gital was (SPEC 12.11): typed in as a list's entry
 * is, each an arrival no shop brought. A product's row keeps the list its
 * last shop came from, so finishing it still goes back there.
 */
export function stockPantry(entries: readonly Entry[]): Promise<RowsWritten> {
  return writeUndoable(async () => {
    const writes: RowWrite[] = [];
    const made = new Map<string, string>();
    for (const entry of entries) {
      let pantryItemId = made.get(foldName(entry.name));
      if (!pantryItemId) {
        const item = await pantryItemRows(entry.name, {});
        pantryItemId = item.pantryItemId;
        made.set(foldName(entry.name), pantryItemId);
        writes.push(...item.rows);
      }
      writes.push({ table: "pantry_moves", row: { id: uuidv7(), pantryItemId, ...quantityOrOne(entry) } });
    }
    return writes;
  });
}

/** A bought row as an arrival reads it. */
export function boughtEntry(row: RowSnapshot): { id: string } & Entry {
  return { id: String(row.id), name: String(row.name), quantityMilli: row.quantity_milli as number | null, unit: row.unit as Unit | null };
}

/** How far back a pull looks for a shop someone else finished: each bought row costs a hash. */
const SETTLE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A shared list's shop someone else finished (SPEC 12.2, 12.5): what this
 * person ticked comes home to the Kiler they are in, and goes again with an
 * undo. Each person's device settles their own ticks after a pull. The
 * arrival's id is the bought row's, so a shop seen twice, or on a second
 * device, adds nothing twice; a list never shared is left to its own finish,
 * which stocked it. An arrival an undo took back returns with the shop only
 * while its product is still at home, since a pantry reset takes both. A shop
 * finished before this device changed Kiler belongs to the one it had: joined
 * empty, or gone from a household, the person starts with nothing.
 */
export async function settleArrivals(userId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const window = new Date(Date.now() - SETTLE_WINDOW_MS).toISOString();
  const { since: switched } = await heldPantry(userId);
  const since = switched != null && switched > window ? switched : window;
  await writeRows(async () => {
    const bought = await sqlite.getAllAsync<RowSnapshot>(
      `SELECT items.*, items.deleted_at IS NULL AND shops.deleted_at IS NULL AS home FROM items
         JOIN shops ON shops.id = items.shop_id
         JOIN lists ON lists.id = items.list_id
       WHERE items.checked_by = ? AND lists.pantry = 1 AND shops.finished_at > ?
         AND EXISTS (SELECT 1 FROM list_members WHERE list_members.list_id = items.list_id)`,
      [userId, since],
    );
    const writes: RowWrite[] = [];
    for (const row of bought) {
      const home = row.home === 1;
      const arrival = await findRow("pantry_moves", await deterministicId(naturalKeys.arrival(String(row.id))));
      if (!arrival) {
        if (home) writes.push(...(await arrivalRows(String(row.list_id), [boughtEntry(row)])));
      } else if (arrival.deleted_at == null && !home) {
        writes.push(...editRow("pantry_moves", arrival, { deletedAt: nowIso() }));
      } else if (arrival.deleted_at != null && home && (await findLiveRow("pantry_items", String(arrival.pantry_item_id)))) {
        writes.push(...editRow("pantry_moves", arrival, { deletedAt: null }));
      }
    }
    return writes;
  });
}

/** An undone shop's arrivals, tombstoned: what it bought was not brought home after all. */
export async function arrivalsOf(boughtIds: readonly string[], now: string): Promise<RowWrite[]> {
  const ids = await Promise.all(boughtIds.map((id) => deterministicId(naturalKeys.arrival(id))));
  const sqlite = await getSqliteAsync();
  const live = await sqlite.getAllAsync<RowSnapshot>(
    `SELECT * FROM pantry_moves WHERE id IN (${ids.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
    ids,
  );
  return live.flatMap((row) => editRow("pantry_moves", row, { deletedAt: now }));
}

async function readStock(id: string): Promise<PantryItem> {
  const stock = (await readStocks(and(eq(pantryItems.id, id), isNull(pantryItems.deletedAt)))).get(id);
  if (!stock) throw new Error("Cannot use what is not at home");
  return stock;
}

/**
 * Empty a product and put it on the list it last came from (SPEC 12.2), in
 * one write the undo bar takes back whole. A list deleted since takes nothing,
 * and so does one this person only views: in a household, the list a product
 * came from may be another member's.
 */
async function finishWith(id: string, rest: (stock: PantryItem) => Stock | null): Promise<Finished | null> {
  const outcome: { finished: boolean; listName: string | null } = { finished: false, listName: null };
  const written = await writeUndoable(async () => {
    const stock = await readStock(id);
    const move = rest(stock) ?? { quantityMilli: -stock.quantityMilli, unit: stock.unit };
    const writes: RowWrite[] = [{ table: "pantry_moves", row: { id: uuidv7(), pantryItemId: id, ...move } }];
    outcome.finished = stockOf([stock, move]) == null;
    if (!outcome.finished) return writes;
    const item = await readLiveRow("pantry_items", id);
    // The date was the stay's; the next arrival is another package.
    writes.push(...editRow("pantry_items", item, { expiresOn: null }));
    const [list] = item.list_id == null
      ? []
      : await getDb()
          .select({ id: lists.id, name: lists.name, viewer: viewing() })
          .from(lists)
          .where(and(eq(lists.id, String(item.list_id)), isNull(lists.deletedAt)));
    if (!list || list.viewer) return writes;
    outcome.listName = list.name;
    return [...writes, ...(await entryRows(list.id, [{ name: stock.name, quantityMilli: null, unit: null, note: null, urgent: false }]))];
  });
  return outcome.finished ? { written, listName: outcome.listName } : null;
}

/** Date a product at home (SPEC 12.3), or with `null` take the date off. */
export async function setExpiry(id: string, expiresOn: ISODate | null): Promise<void> {
  if (expiresOn != null && !isISODate(expiresOn)) throw new Error("An expiry is a calendar day");
  await writeRows(async () => {
    await readStock(id);
    return editRow("pantry_items", await readLiveRow("pantry_items", id), { expiresOn });
  });
}

/** One press of −: a step less, and `Finished` when that leaves nothing (SPEC 12.8). */
export function takeSome(id: string): Promise<Finished | null> {
  return finishWith(id, lessOf);
}

/**
 * What the calculator counted at home, in the unit it is held in: the move
 * is the difference, so the stay and its rhythm (12.7) go on. Nothing
 * finishes it, as − reaching nothing does (12.8).
 */
export async function setStock(id: string, quantityMilli: number): Promise<Finished | null> {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0) throw new Error("A stock is whole thousandths");
  return finishWith(id, (stock) => ({ quantityMilli: quantityMilli - stock.quantityMilli, unit: stock.unit }));
}

export async function finishPantryItem(id: string): Promise<Finished> {
  return (await finishWith(id, () => null))!;
}

/**
 * Deleted from its panel: emptied as a finish is, but onto no list, since it
 * did not run out — it was never there, or it went in the bin. One write, so
 * one undo; what is no longer at home is skipped, and `null` when none was.
 */
export async function removePantryItems(ids: readonly string[]): Promise<RowsWritten | null> {
  const written = await writeUndoable(async () => {
    const stocks = await readStocks(and(inArray(pantryItems.id, [...ids]), isNull(pantryItems.deletedAt)));
    const writes: RowWrite[] = [];
    for (const id of new Set(ids)) {
      const stock = stocks.get(id);
      if (!stock) continue;
      writes.push(
        { table: "pantry_moves", row: { id: uuidv7(), pantryItemId: id, quantityMilli: -stock.quantityMilli, unit: stock.unit } },
        ...editRow("pantry_items", await readLiveRow("pantry_items", id), { expiresOn: null }),
      );
    }
    return writes;
  });
  return written.writes.length > 0 ? written : null;
}

export { undoRows as undoFinish } from "../db/mutations";
