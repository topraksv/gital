/**
 * Helix's device-local key-value store: SecureStore on native, localStorage on
 * web. Preferences only — never a credential, since any script on the web
 * origin can read localStorage. `tests/auth/auth.test.ts` holds every key to that.
 * The one bearer value is a web invitation waiting for sign-in, single-use
 * and seven days at most, which `docs/SECURITY.md` accepts.
 *
 * Best-effort on web by contract: a browser that blocks site data throws on
 * the property access itself and a full one on the write, and a refused write
 * is dropped rather than failing the action that made it. A resolved `set` is
 * therefore not proof of a stored value.
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const kv = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // See the header: a dropped preference beats a failed action.
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // As `set`: a store the browser blocks holds nothing to remove.
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * A device-local on/off choice, on unless turned off: read once at start,
 * changed at once for every screen holding it. The shape `useSyncExternalStore`
 * takes, so a hook is one line.
 */
export function kvSwitch(key: string) {
  let on = true;
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());
  void kv.get(key).then((stored) => {
    if (stored !== "false") return;
    on = false;
    tell();
  });
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: (): boolean => on,
    set(next: boolean): void {
      on = next;
      tell();
      void kv.set(key, String(next));
    },
  };
}
