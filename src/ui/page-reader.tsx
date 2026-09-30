/**
 * The web build reads no shop's page: the browser refuses another site's HTML
 * (CORS), and the shops' bot walls refuse a server (`./page-reader.native.tsx`).
 * A link added here is filled by the phone that next opens its collection.
 */

import type { Wish } from "../domain/wishes";

export function PageReaderHost() {
  return null;
}

export function readLinkPages(_wishId: string): void {}

export function readUnreadPages(_wishes: readonly Wish[]): void {}

export function useReadingWish(_wishId: string): boolean {
  return false;
}
