/** The lists a screen reads and the four things it can do to one. */

import { and, asc, count, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "../db/client";
import { editRow, readLiveRow, restoreRow, softDelete, writeRows, type RowSnapshot } from "../db/mutations";
import { items, lists } from "../db/schema";
import { nameFrom } from "../domain/names";

export interface ListSummary {
  id: string;
  name: string;
  /** Items on the list, the basket included. */
  total: number;
  inBasket: number;
}

/** Oldest first, so a new list joins the end and nothing already there moves. */
export function readLists(): Promise<ListSummary[]> {
  return getDb()
    .select({ id: lists.id, name: lists.name, total: count(items.id), inBasket: count(items.checkedAt) })
    .from(lists)
    .leftJoin(items, and(eq(items.listId, lists.id), isNull(items.deletedAt)))
    .where(isNull(lists.deletedAt))
    .groupBy(lists.id)
    .orderBy(asc(lists.createdAt), asc(lists.id));
}

function nameOrThrow(input: string): string {
  const name = nameFrom(input);
  // The screens never offer an empty name; this is the layer that cannot rely on it.
  if (name == null) throw new Error("A list needs a name");
  return name;
}

export async function createList(input: string): Promise<string> {
  const name = nameOrThrow(input);
  const id = uuidv7();
  await writeRows([{ table: "lists", row: { id, name } }]);
  return id;
}

export async function renameList(id: string, input: string): Promise<void> {
  const name = nameOrThrow(input);
  await writeRows(async () => editRow("lists", await readLiveRow("lists", id), { name }));
}

/** Returns what undo needs, or `null` when the list was already gone. */
export function deleteList(id: string): Promise<RowSnapshot | null> {
  return softDelete("lists", id);
}

export function restoreList(snapshot: RowSnapshot): Promise<void> {
  return restoreRow("lists", snapshot);
}
