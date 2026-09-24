/** React's side of the live stores; what they decide lives in `live-query.ts`. */

import { useMemo, useSyncExternalStore } from "react";
import { readItems } from "./items";
import { readLists } from "./lists";
import { liveStore } from "./live-query";

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
