/** React's side of the live stores; what they decide lives in `live-query.ts`. */

import { useSyncExternalStore } from "react";
import { readLists } from "./lists";
import { liveStore } from "./live-query";

const listsStore = liveStore(readLists, ["lists"]);

export function useLists() {
  return useSyncExternalStore(listsStore.subscribe, listsStore.getSnapshot, listsStore.getSnapshot);
}
