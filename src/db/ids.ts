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
   * An item still to buy (`docs/ARCHITECTURE.md`, Tables). The shop number
   * starts a fresh row once a shop has filed the old one into history, so
   * "süt" bought last week and "süt" needed today are two rows.
   */
  openItem: (listId: string, foldedName: string, shopsFinished: number) => `item:${listId}:${foldedName}:${shopsFinished}`,
};
