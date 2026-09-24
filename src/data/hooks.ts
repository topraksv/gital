/** React's side of the live stores; what they decide lives in `live-query.ts`. */

import { useMemo, useSyncExternalStore } from "react";
import { readItems, readKnownProducts, readShopItems } from "./items";
import { readLists } from "./lists";
import { liveStore } from "./live-query";
import { readShops } from "./shops";

// Items, because each card counts what is on its list.
const listsStore = liveStore(readLists, ["lists", "items"]);

export function useLists() {
  return useSyncExternalStore(listsStore.subscribe, listsStore.getSnapshot, listsStore.getSnapshot);
}

// One screen watches a list's items, so the store lives and goes with it;
// the lists store is shared by the tab and the screen pushed over it.
export function useItems(listId: string) {
  const store = useMemo(() => liveStore(() => readItems(listId), ["items"]), [listId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Lists, because a shop's card names its list. Not items: what a shop counts
// changes only when it is finished or undone, which writes the shop as well,
// and a tick on a list must not re-read every shop.
const shopsStore = liveStore(readShops, ["shops", "lists"]);

export function useShops() {
  return useSyncExternalStore(shopsStore.subscribe, shopsStore.getSnapshot, shopsStore.getSnapshot);
}

export function useShopItems(shopId: string) {
  const store = useMemo(() => liveStore(() => readShopItems(shopId), ["items"]), [shopId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Watched only while the quick-add field holds text, when the suggestions are
// mounted: every tick changes `items`, and nobody is waiting on this in between.
const knownStore = liveStore(readKnownProducts, ["items", "lists"]);

export function useKnownProducts() {
  return useSyncExternalStore(knownStore.subscribe, knownStore.getSnapshot, knownStore.getSnapshot);
}
