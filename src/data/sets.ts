/**
 * Ready-made sets (SPEC 5.3): a person's named bundles of products, made from
 * a list's open items and put onto any list in one tap, through the same
 * write a pasted list takes (`importEntries`), so what is there merges.
 */

import { and, asc, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "../db/client";
import { deleteRow, writeRows, type RowsWritten } from "../db/mutations";
import { setItems, sets } from "../db/schema";
import { foldName, type ListedEntry } from "../domain/items";
import { nameFrom } from "../domain/names";

export interface ProductSet {
  id: string;
  name: string;
  entries: ListedEntry[];
}

export async function readSets(): Promise<ProductSet[]> {
  const db = getDb();
  const heads = await db.select({ id: sets.id, name: sets.name }).from(sets).where(isNull(sets.deletedAt));
  if (heads.length === 0) return [];
  const rows = await db
    .select({ setId: setItems.setId, name: setItems.name, quantityMilli: setItems.quantityMilli, unit: setItems.unit, note: setItems.note })
    .from(setItems)
    .where(and(inArray(setItems.setId, heads.map((head) => head.id)), isNull(setItems.deletedAt)))
    .orderBy(asc(setItems.position));
  return heads
    .map(({ id, name }) => ({
      id,
      name,
      entries: rows.filter((row) => row.setId === id).map(({ setId: _, ...entry }) => ({ ...entry, urgent: false })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Named twice, a product keeps its first place and takes the last quantity and note given, as a list's entry does. */
export async function createSet(input: string, entries: readonly ListedEntry[]): Promise<string> {
  const name = nameFrom(input);
  const held = new Map<string, ListedEntry>();
  for (const entry of entries) {
    const key = foldName(entry.name);
    const before = held.get(key);
    const quantity = entry.quantityMilli == null && before ? before : entry;
    held.set(key, { ...(before ?? entry), quantityMilli: quantity.quantityMilli, unit: quantity.unit, note: entry.note ?? before?.note ?? null });
  }
  // The screens offer neither; this is the layer that cannot rely on it.
  if (name == null || held.size === 0) throw new Error("A set needs a name and a product");
  const id = uuidv7();
  await writeRows([
    { table: "sets", row: { id, name } },
    ...[...held.values()].map(({ name: product, quantityMilli, unit, note }, position) => ({
      table: "set_items" as const,
      row: { id: uuidv7(), setId: id, name: product, quantityMilli, unit, note, position },
    })),
  ]);
  return id;
}

/** Its items stay under the tombstone, so `undoRows` brings the set back whole. */
export function deleteSet(id: string): Promise<RowsWritten | null> {
  return deleteRow("sets", id);
}

export { undoRows as restoreSet } from "../db/mutations";

