/**
 * Resetting the data (SPEC 9.1), Helix's `data/repo/reset.ts` for a
 * household's records: the person chooses parts, and each goes whole with
 * what hangs from it. Everything leaves as a tombstone, so the account's other
 * devices follow; settings never go, since a reset keeps the account.
 *
 * Helix's date range is left out: its parts are ledgers a year deep, and a
 * shopping list's history is the one part here with dates at all.
 */

import { getSqliteAsync } from "../db/client";
import { actingUser, fromDbShape, nowIso, writeRows, type RowSnapshot, type RowWrite } from "../db/mutations";
import type { SyncedTableName } from "../db/schema";
import { heldPantry } from "./pantry";

export const RESET_SCOPES = ["lists", "history", "wishes", "products", "sets", "pantry"] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

/**
 * A list someone else owns is theirs, and so are its rows and its history: a
 * member who resets lets none of it go, or an editor would empty the owner's
 * list for everyone. Leaving is how a member lets a list go.
 */
const THEIRS = "SELECT list_id FROM list_members WHERE user_id = ? AND role <> 'owner'";
const LIST_COLUMN: Partial<Record<SyncedTableName, string>> = { lists: "id", items: "list_id", shops: "list_id", wishes: "list_id", wish_links: "list_id" };

const SHOP_LISTS = "SELECT id FROM lists WHERE kind = 'shop'";
const WISH_LISTS = "SELECT id FROM lists WHERE kind = 'wish'";

/**
 * Each part's tables and which of their rows. A list's children are taken by
 * their list whether or not it is live: deleting a list leaves them, and a
 * reset that kept them would count what the person can no longer see.
 */
const PARTS: Record<ResetScope, readonly (readonly [SyncedTableName, string])[]> = {
  lists: [
    ["lists", "kind = 'shop'"],
    ["items", `list_id IN (${SHOP_LISTS})`],
    ["shops", `list_id IN (${SHOP_LISTS})`],
  ],
  history: [
    ["shops", "1"],
    ["items", "shop_id IS NOT NULL"],
  ],
  wishes: [
    ["lists", "kind = 'wish'"],
    ["wishes", `list_id IN (${WISH_LISTS})`],
    ["wish_links", `list_id IN (${WISH_LISTS})`],
  ],
  products: [["products", "1"]],
  sets: [
    ["sets", "1"],
    ["set_items", "1"],
  ],
  pantry: [
    ["pantry_items", "1"],
    ["pantry_moves", "1"],
  ],
};

/**
 * A household's Kiler (SPEC 12.13) is its owner's to reset, as a shared list
 * is: the owner's reset empties it for everyone, a member's leaves it alone.
 */
export async function inHousehold(): Promise<boolean> {
  const me = actingUser();
  return me != null && (await heldPantry(me)).id !== me;
}

/** Every live row the parts take, once each. */
async function chosenRows(scopes: readonly ResetScope[]): Promise<Map<string, readonly [SyncedTableName, RowSnapshot]>> {
  const sqlite = await getSqliteAsync();
  const rows = new Map<string, readonly [SyncedTableName, RowSnapshot]>();
  const kept = (await inHousehold()) ? "pantry" : null;
  for (const [table, which] of scopes.filter((scope) => scope !== kept).flatMap((scope) => PARTS[scope])) {
    const column = LIST_COLUMN[table];
    const own = column ? ` AND ${column} NOT IN (${THEIRS})` : "";
    for (const row of await sqlite.getAllAsync<RowSnapshot>(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND (${which})${own}`, column ? [actingUser()] : [])) {
      rows.set(`${table}:${String(row.id)}`, [table, row]);
    }
  }
  return rows;
}

/** How many records the parts would take, shown before anything goes. */
export async function countDataReset(scopes: readonly ResetScope[]): Promise<number> {
  return (await chosenRows(scopes)).size;
}

/** Take them, in one transaction, and say how many went. */
export async function resetData(scopes: readonly ResetScope[]): Promise<number> {
  let taken = 0;
  await writeRows(async () => {
    const deletedAt = nowIso();
    // A shop says it was cleared, so no member's Kiler reads it as an undo and gives back what it brought.
    const writes: RowWrite[] = [...(await chosenRows(scopes)).values()].map(([table, row]) => ({
      table,
      row: { ...fromDbShape(table, row), deletedAt, ...(table === "shops" && { clearedAt: deletedAt }) },
    }));
    taken = writes.length;
    return writes;
  });
  return taken;
}
