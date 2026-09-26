/**
 * Ids for rows two devices can make on their own: Helix's `deterministicId`
 * (`src/db/ids.ts`). The id is a hash of the row's natural key, so both
 * devices mint the same primary key and sync meets one row instead of two.
 * Every other row takes a uuidv7 where it is made.
 */

import * as Crypto from "expo-crypto";

/** SHA-256 of the key in a UUID's shape, its version nibble 8 so it never meets the v7 space. */
export async function deterministicId(naturalKey: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, naturalKey);
  const h = hex.slice(0, 32).split("");
  h[12] = "8";
  h[16] = "8";
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export const naturalKeys = {
  /**
   * An item on a list (`docs/ARCHITECTURE.md`, Tables): one row per product,
   * which is 2.5's merge. The `:0` counted finished shops once; rows already
   * on devices were made under it, so it stays.
   */
  openItem: (listId: string, foldedName: string) => `item:${listId}:${foldedName}:0`,
  /** A list's nth finished shop, so two members finishing at once write one. */
  shop: (listId: string, number: number) => `shop:${listId}:${number}`,
  /** What a shop bought of a product: history's own row, apart from the list's. */
  boughtItem: (shopId: string, foldedName: string) => `bought:${shopId}:${foldedName}`,
  /** A product at home. The person joins the key with accounts, since a pantry is theirs alone. */
  pantryItem: (foldedName: string) => `pantry:${foldedName}`,
  /** What a bought item brought home, so a shop seen twice adds it once (SPEC 12.9). */
  arrival: (boughtItemId: string) => `arrival:${boughtItemId}`,
};
