/** React's side of the live stores; what they decide lives in `live-query.ts`. */

import { useMemo, useSyncExternalStore } from "react";
import type { Aisle } from "../domain/catalogue";
import { foldName } from "../domain/items";
import { readBought, readItems, readKnownProducts, readShopItems } from "./items";
import { readLists } from "./lists";
import { readFresh, readMembers, readSharedLists } from "./members";
import { liveStore } from "./live-query";
import { heldPantry, readLasted, readPantry } from "./pantry";
import { readProducts } from "./products";
import { readSets } from "./sets";
import { frozenFrom, readSettings } from "./settings";
import { readPricedSince, readPurchases, readShops } from "./shops";
import { readCollections, readKnownWishes, readWishes } from "./wishes";

// A list's screen and its people panel watch its members: the role decides what the screen offers.
export function useMembers(listId: string) {
  const store = useMemo(() => liveStore(() => readMembers(listId), ["list_members"]), [listId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Listeler's count of what is new on each shared list (SPEC 1.9), for the person signed in.
export function useFresh(userId: string) {
  const store = useMemo(() => liveStore(() => readFresh(userId), ["items", "list_members"]), [userId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// The Kiler this device holds (SPEC 12.13). It changes at a sync that empties
// Kiler and fills it again, which a membership coming or going goes with.
export function useHeldPantry(userId: string) {
  const store = useMemo(() => liveStore(async () => [await heldPantry(userId)], ["pantry_items", "list_members"]), [userId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// The lists kept live, each on its own channel (SPEC 1.3).
export function useSharedLists(userId: string) {
  const store = useMemo(() => liveStore(() => readSharedLists(userId), ["list_members"]), [userId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Items, because each card counts what is on its list; members, because a viewer sends nothing.
const listsStore = liveStore(readLists, ["lists", "items", "list_members"]);

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

// İstekler's own, watched the same way: a wish is not a product.
const knownWishesStore = liveStore(readKnownWishes, ["wishes", "lists"]);

export function useKnownWishes() {
  return useSyncExternalStore(knownWishesStore.subscribe, knownWishesStore.getSnapshot, knownWishesStore.getSnapshot);
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

// Shared by the item panel's star and aisle, the catalogue's Favoriler, and
// every screen that groups by aisle.
const productsStore = liveStore(readProducts, ["products"]);

export function useProducts() {
  return useSyncExternalStore(productsStore.subscribe, productsStore.getSnapshot, productsStore.getSnapshot);
}

/** Where the person moved each product, by folded name (SPEC 5.4). */
export function useMovedAisles(): ReadonlyMap<string, Aisle> {
  const { data } = useProducts();
  return useMemo(() => new Map(data.flatMap(({ name, aisle }) => (aisle ? [[foldName(name), aisle] as const] : []))), [data]);
}

// Mounted with the catalogue panel's Setler.
const setsStore = liveStore(readSets, ["sets", "set_items"]);

export function useSets() {
  return useSyncExternalStore(setsStore.subscribe, setsStore.getSnapshot, setsStore.getSnapshot);
}

const settingsStore = liveStore(readSettings, ["settings"]);
const unwatched = () => () => {};

export function useSettings() {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getSnapshot);
}

/**
 * Whether the account is frozen (SPEC 9.1); watched only while signed in, since
 * the reset page opens no database. Unwatched is unknown: the store keeps the
 * last account's answer until the unsubscribe that follows its sign-out.
 */
export function useAccountFrozen(watching: boolean): boolean | null {
  const snapshot = useSyncExternalStore(watching ? settingsStore.subscribe : unwatched, settingsStore.getSnapshot, settingsStore.getSnapshot);
  return watching ? frozenFrom(snapshot) : null;
}
