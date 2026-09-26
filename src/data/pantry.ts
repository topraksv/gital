/** The pantry (SPEC 12.2, 12.8): what is at home, filled by finished shops and emptied by hand. */

import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { editRow, findLiveRow, findRow, readLiveRow, revertRows, writeRows, writeUndoable, type RowSnapshot, type RowWrite, type RowsWritten } from "../db/mutations";
import { pantryItems, pantryMoves } from "../db/schema";
import { isISODate, type ISODate } from "../domain/dates";
import { foldName, quantityOrOne, type Entry } from "../domain/items";
import { lastedOf, lessOf, stockOf, type Stock } from "../domain/pantry";
import { entryRows } from "./items";

export interface PantryItem extends Stock {
  id: string;
  name: string;
  expiresOn: ISODate | null;
}

/** A product finished, for the undo bar: the list it went back on, if that list is still there. */
export interface Finished {
  written: RowsWritten;
  listName: string | null;
}

/** Each pantry row's moves, oldest first. */
async function readMoves(where = isNull(pantryItems.deletedAt)): Promise<Map<string, { name: string; expiresOn: ISODate | null; moves: (Stock & { at: string })[] }>> {
  const rows = await getDb()
    .select({ id: pantryItems.id, name: pantryItems.name, expiresOn: pantryItems.expiresOn, quantityMilli: pantryMoves.quantityMilli, unit: pantryMoves.unit, at: pantryMoves.createdAt })
    .from(pantryItems)
    .innerJoin(pantryMoves, and(eq(pantryMoves.pantryItemId, pantryItems.id), isNull(pantryMoves.deletedAt)))
    .where(where)
    .orderBy(asc(pantryMoves.createdAt), asc(pantryMoves.id));
  const moves = new Map<string, { name: string; expiresOn: ISODate | null; moves: (Stock & { at: string })[] }>();
  for (const { id, name, expiresOn, ...move } of rows) {
    const held = moves.get(id) ?? { name, expiresOn, moves: [] };
    held.moves.push(move);
    moves.set(id, held);
  }
  return moves;
}

async function readStocks(where?: SQL): Promise<Map<string, PantryItem>> {
  const stocks = new Map<string, PantryItem>();
  for (const [id, { name, expiresOn, moves: all }] of await readMoves(where)) {
    const stock = stockOf(all);
    if (stock) stocks.set(id, { id, name, expiresOn, quantityMilli: stock.quantityMilli, unit: stock.unit });
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

/** What is at home, by name; a product used up is not. */
export async function readPantry(): Promise<PantryItem[]> {
  return [...(await readStocks()).values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
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
    const pantryItemId = await deterministicId(naturalKeys.pantryItem(foldName(item.name)));
    const there = await findRow("pantry_items", pantryItemId);
    writes.push(
      ...(there
        ? editRow("pantry_items", there, { listId, deletedAt: null })
        : [{ table: "pantry_items" as const, row: { id: pantryItemId, name: item.name, listId, deletedAt: null } }]),
      {
        table: "pantry_moves",
        row: { id: await deterministicId(naturalKeys.arrival(item.id)), pantryItemId, ...quantityOrOne(item), deletedAt: null, tombstoneVersion: 0 },
      },
    );
  }
  return writes;
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
 * one write the undo bar takes back whole. A list deleted since takes nothing.
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
    const list = item.list_id == null ? null : await findLiveRow("lists", String(item.list_id));
    if (!list) return writes;
    outcome.listName = String(list.name);
    return [...writes, ...(await entryRows(String(list.id), [{ name: stock.name, quantityMilli: null, unit: null, note: null, urgent: false }]))];
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

export async function finishPantryItem(id: string): Promise<Finished> {
  return (await finishWith(id, () => null))!;
}

export function undoFinish(written: RowsWritten): Promise<void> {
  return revertRows(written, async () => {});
}
