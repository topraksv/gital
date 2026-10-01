/** The lists a screen reads and the four things it can do to one. */

import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "../db/client";
import { actingUser, deleteRow, editRow, readLiveRow, writeRows, type RowsWritten } from "../db/mutations";
import { items, lists, type ListKind } from "../db/schema";
import { LIST_COLORS, LIST_ICONS, iconForName, knownOf, lookOf, type ListLook } from "../domain/lists";
import { nameFrom } from "../domain/names";

export interface ListSummary extends ListLook {
  id: string;
  pantry: boolean;
  /** Items on the list, the basket included; a finished shop's are history. */
  total: number;
  inBasket: number;
  /** Shared with this person to read: nothing is sent to it, since the server would refuse it and set it aside. */
  viewer: boolean;
}

/**
 * Whether the person signed in only views the `lists` row selected beside it:
 * the server refuses anything sent to it. Spelled out, because drizzle leaves
 * a column unqualified in a query with no join, where `id` would be the member's.
 */
export const viewing = () =>
  sql<boolean>`EXISTS (SELECT 1 FROM list_members m WHERE m.list_id = lists.id AND m.user_id = ${actingUser()}
    AND m.role = 'viewer' AND m.deleted_at IS NULL)`.mapWith(Boolean);

/** Oldest first, so a new list joins the end and nothing already there moves. Wish collections are İstekler's. */
export async function readLists(): Promise<ListSummary[]> {
  const rows = await getDb()
    .select({ id: lists.id, name: lists.name, color: lists.color, icon: lists.icon, pantry: lists.pantry, total: count(items.id), inBasket: count(items.checkedAt), viewer: viewing() })
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
  await writeRows([{ table: "lists", row: { id, name, kind, icon: iconForName(name) } }]);
  return id;
}

/** A shopping list's panel also saves its pantry switch; a wish collection's names none, and one not named is left as it is. */
export async function editList(id: string, look: ListLook & { pantry?: boolean }): Promise<void> {
  const name = nameOrThrow(look.name);
  // Only what this build can draw is written; reading is the lenient side.
  if (look.color !== knownOf(LIST_COLORS, look.color) || look.icon !== knownOf(LIST_ICONS, look.icon)) throw new Error("An unknown look");
  await writeRows(async () => editRow("lists", await readLiveRow("lists", id), {
    name,
    color: look.color,
    icon: look.icon,
    ...(look.pantry != null && { pantry: look.pantry }),
  }));
}

/** Returns what undo needs, or `null` when the list was already gone. */
export function deleteList(id: string): Promise<RowsWritten | null> {
  return deleteRow("lists", id);
}

export { undoRows as restoreList } from "../db/mutations";

