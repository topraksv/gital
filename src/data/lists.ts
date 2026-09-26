/** The lists a screen reads and the four things it can do to one. */

import { and, asc, count, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "../db/client";
import { editRow, readLiveRow, restoreRow, softDelete, writeRows, type RowSnapshot } from "../db/mutations";
import { items, lists, type ListKind } from "../db/schema";
import { LIST_COLORS, LIST_ICONS, knownOf, lookOf, type ListLook } from "../domain/lists";
import { nameFrom } from "../domain/names";

export interface ListSummary extends ListLook {
  id: string;
  /** Items on the list, the basket included; a finished shop's are history. */
  total: number;
  inBasket: number;
}

/** Oldest first, so a new list joins the end and nothing already there moves. Wish collections are İstekler's. */
export async function readLists(): Promise<ListSummary[]> {
  const rows = await getDb()
    .select({ id: lists.id, name: lists.name, color: lists.color, icon: lists.icon, total: count(items.id), inBasket: count(items.checkedAt) })
    .from(lists)
    .leftJoin(items, and(eq(items.listId, lists.id), isNull(items.shopId), isNull(items.deletedAt)))
    .where(and(isNull(lists.deletedAt), eq(lists.kind, "shop")))
    .groupBy(lists.id)
    .orderBy(asc(lists.createdAt), asc(lists.id));
  return rows.map(lookOf);
}

function nameOrThrow(input: string): string {
  const name = nameFrom(input);
  // The screens never offer an empty name; this is the layer that cannot rely on it.
  if (name == null) throw new Error("A list needs a name");
  return name;
}

export async function createList(input: string, kind: ListKind = "shop"): Promise<string> {
  const name = nameOrThrow(input);
  const id = uuidv7();
  await writeRows([{ table: "lists", row: { id, name, kind } }]);
  return id;
}

export async function editList(id: string, look: ListLook): Promise<void> {
  const name = nameOrThrow(look.name);
  // Only what this build can draw is written; reading is the lenient side.
  if (look.color !== knownOf(LIST_COLORS, look.color) || look.icon !== knownOf(LIST_ICONS, look.icon)) throw new Error("An unknown look");
  await writeRows(async () => editRow("lists", await readLiveRow("lists", id), { name, color: look.color, icon: look.icon }));
}

/** Returns what undo needs, or `null` when the list was already gone. */
export function deleteList(id: string): Promise<RowSnapshot | null> {
  return softDelete("lists", id);
}

export function restoreList(snapshot: RowSnapshot): Promise<void> {
  return restoreRow("lists", snapshot);
}
