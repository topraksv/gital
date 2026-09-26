/** React's side of the live stores; what they decide lives in `live-query.ts`. */

import { useMemo, useSyncExternalStore } from "react";
import { readBought, readItems, readKnownProducts, readShopItems } from "./items";
import { readLists } from "./lists";
import { liveStore } from "./live-query";
import { readLasted, readPantry } from "./pantry";
import { readPricedSince, readPurchases, readShops } from "./shops";
import { readCollections, readWishes } from "./wishes";

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

// Keyed by the month's start, so a new month reads afresh.
export function usePricedSince(since: string) {
  const store = useMemo(() => liveStore(() => readPricedSince(since), ["shops", "lists", "items"]), [since]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
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

// Mounted with the item panel, and gone with it.
export function useBought(itemId: string) {
  const store = useMemo(() => liveStore(() => readBought(itemId), ["items", "lists"]), [itemId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Shops only: a finish writes its shop after its items, and an undo tombstones
// it, so a tick on the list never re-reads the history.
export function usePurchases(listId: string) {
  const store = useMemo(() => liveStore(() => readPurchases(listId), ["shops"]), [listId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Every wish and link, because each card counts and prices its collection.
const collectionsStore = liveStore(readCollections, ["lists", "wishes", "wish_links"]);

export function useCollections() {
  return useSyncExternalStore(collectionsStore.subscribe, collectionsStore.getSnapshot, collectionsStore.getSnapshot);
}

export function useWishes(listId: string) {
  const store = useMemo(() => liveStore(() => readWishes(listId), ["wishes", "wish_links"]), [listId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const pantryStore = liveStore(readPantry, ["pantry_items", "pantry_moves"]);

export function usePantry() {
  return useSyncExternalStore(pantryStore.subscribe, pantryStore.getSnapshot, pantryStore.getSnapshot);
}

// Mounted with the restock chips, which show while the add field is empty.
const lastedStore = liveStore(readLasted, ["pantry_items", "pantry_moves"]);

export function useLasted() {
  return useSyncExternalStore(lastedStore.subscribe, lastedStore.getSnapshot, lastedStore.getSnapshot);
}
