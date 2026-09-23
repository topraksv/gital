/**
 * Helix's device-local key-value store: SecureStore on native, localStorage on
 * web. Preferences only — never a credential, since any script on the web
 * origin can read localStorage.
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
};
