/** A person's own products (SPEC 5.1): what they starred, by name, whatever list it was on. */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { editRow, findRow, writeRows } from "../db/mutations";
import { products } from "../db/schema";
import { foldName } from "../domain/items";

export interface Favourite {
  name: string;
}

export async function readFavourites(): Promise<Favourite[]> {
  const rows = await getDb()
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.starred, true), isNull(products.deletedAt)));
  return rows.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** The row keeps the spelling it was first starred under, as a list keeps an item's. */
export async function setStarred(name: string, starred: boolean): Promise<void> {
  const folded = foldName(name);
  if (!folded) throw new Error("A favourite needs a name");
  const id = await deterministicId(naturalKeys.product(folded));
  await writeRows(async () => {
    const there = await findRow("products", id);
    return there
      ? editRow("products", there, { starred, deletedAt: null })
      : [{ table: "products" as const, row: { id, name: name.trim(), starred, deletedAt: null } }];
  });
}
