/**
 * The Supabase client, Helix's (`src/sync/supabase.ts`). The session is kept
 * on the device — SecureStore on a phone, chunked past its 2 KB value limit;
 * localStorage on the web — so the app opens offline, and a refresh that fails
 * never stands between the person and their lists.
 */

import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { createSecureChunkedStorage } from "./secure-chunked-storage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False in a build without `.env`, which then runs on the device alone (`src/auth/session.ts`). */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        storage: Platform.OS === "web" ? undefined : createSecureChunkedStorage(SecureStore),
        autoRefreshToken: true,
        persistSession: true,
        // The web takes back only the PKCE code a confirmation link returns
        // to the browser that signed up. A session in the fragment is the
        // reset page's, redeemed on a client of its own, and must not become
        // this one's — nor be wiped from the address before that page reads it.
        detectSessionInUrl: Platform.OS === "web" ? () => false : false,
        flowType: "pkce",
      },
    });
    client.auth.onAuthStateChange((event, session) => {
      for (const listener of listeners) listener(event, session);
    });
  }
  return client;
}

/** One Supabase listener for the app; a callback must not await auth work (Supabase's rule). */
export function subscribeSupabaseAuthEvents(listener: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  getSupabase();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The reset link's client, sharing nothing with the app's own. Unpersisted,
 * as Helix's: the web mirrors a persisted session to every tab, so a link
 * opened beside a signed-in tab would have handed that tab another account.
 * Implicit, unlike Helix's: the reset e-mail keeps Supabase's template, and a
 * PKCE request would return a code only the device that asked can redeem —
 * a phone in Expo Go, not the browser its mail app opens.
 */
export function createRecoveryClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit", storageKey: "gital-password-recovery" },
  });
}
