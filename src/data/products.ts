/**
 * A person's own products, by name whatever list they were on: what they
 * starred (SPEC 5.1) and the aisle they moved one to (5.4).
 */

import { isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { editRow, findRow, writeRows } from "../db/mutations";
import { products } from "../db/schema";
import { AISLES, type Aisle } from "../domain/catalogue";
import { foldName } from "../domain/items";

export interface Product {
  name: string;
  starred: boolean;
  aisle: Aisle | null;
}

export async function readProducts(): Promise<Product[]> {
  const rows = await getDb()
    .select({ name: products.name, starred: products.starred, aisle: products.aisle })
    .from(products)
    .where(isNull(products.deletedAt));
  return rows.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export function setStarred(name: string, starred: boolean): Promise<void> {
  return keep(name, { starred });
}

/** `null` puts it back where the catalogue has it. */
export function setAisle(name: string, aisle: Aisle | null): Promise<void> {
  if (aisle != null && !AISLES.includes(aisle)) return Promise.reject(new Error("An unknown aisle"));
  return keep(name, { aisle });
}

/** The row keeps the spelling it was first kept under, as a list keeps an item's. */
async function keep(name: string, patch: Partial<Omit<Product, "name">>): Promise<void> {
  const folded = foldName(name);
  if (!folded) throw new Error("A product needs a name");
  const id = await deterministicId(naturalKeys.product(folded));
  await writeRows(async () => {
    const there = await findRow("products", id);
    return there
      ? editRow("products", there, { ...patch, deletedAt: null })
      : [{ table: "products" as const, row: { id, name: name.trim(), starred: false, aisle: null, ...patch, deletedAt: null } }];
  });
}
