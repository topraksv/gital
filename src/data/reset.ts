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
import { fromDbShape, nowIso, writeRows, type RowSnapshot, type RowWrite } from "../db/mutations";
import type { SyncedTableName } from "../db/schema";

export const RESET_SCOPES = ["lists", "history", "wishes", "products", "sets", "pantry"] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

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

/** Every live row the parts take, once each. */
async function chosenRows(scopes: readonly ResetScope[]): Promise<Map<string, readonly [SyncedTableName, RowSnapshot]>> {
  const sqlite = await getSqliteAsync();
  const rows = new Map<string, readonly [SyncedTableName, RowSnapshot]>();
  for (const [table, which] of scopes.flatMap((scope) => PARTS[scope])) {
    for (const row of await sqlite.getAllAsync<RowSnapshot>(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND (${which})`)) {
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
    const writes: RowWrite[] = [...(await chosenRows(scopes)).values()].map(([table, row]) => ({ table, row: { ...fromDbShape(table, row), deletedAt } }));
    taken = writes.length;
    return writes;
  });
  return taken;
}
