/**
 * The Supabase client. The session is kept
 * on the device — SecureStore on a phone, chunked past its 2 KB value limit;
 * localStorage on the web — so the app opens offline, and a refresh that fails
 * never stands between the person and their lists.
 */

import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { parseEmailLinkLanding } from "../auth/recovery";
import { createSecureChunkedStorage } from "./secure-chunked-storage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False in a build without `.env`, which then runs on the device alone (`src/auth/session.ts`). */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
type EmailLinkAnswer = "confirmed" | "changeConfirmed" | "unusable" | "offline";
let emailLinkLanding: Promise<EmailLinkAnswer> | null = null;

/** What Auth said about the e-mail link this page opened from, once. */
export function takeEmailLinkLanding(): Promise<EmailLinkAnswer> | null {
  const landing = emailLinkLanding;
  emailLinkLanding = null;
  return landing;
}

/**
 * Redeem a confirmation token on a client of its own, as a reset token is:
 * the account it confirms may not be the one this device is signed in with,
 * and confirming it signs nobody in here. The token leaves the address bar
 * first, so a reload cannot spend it twice and report the refusal.
 */
function landEmailLink(href: string): Promise<EmailLinkAnswer> | null {
  const landing = parseEmailLinkLanding(href);
  if (landing === null) return null;
  if (landing === "unusable") return Promise.resolve(landing);
  const address = new URL(href);
  address.search = "";
  address.hash = "";
  globalThis.history.replaceState(globalThis.history.state, "", address.href);
  const verifier = createRecoveryClient()!;
  return verifier.auth.verifyOtp({ token_hash: landing.tokenHash, type: landing.type }).then(async ({ error }) => {
    if (error?.name === "AuthRetryableFetchError") {
      // Never reached Auth, so nothing was spent: the link goes back for a reload.
      globalThis.history.replaceState(globalThis.history.state, "", href);
      return "offline";
    }
    if (error) return "unusable";
    await verifier.auth.signOut({ scope: "local" });
    // One side of a change is not the change: with both addresses asked,
    // Auth accepts the first link and still waits for the other.
    return landing.type === "email_change" ? "changeConfirmed" : "confirmed";
  });
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    // Before the client exists, so the landing is read from the address the
    // page opened on.
    if (Platform.OS === "web" && globalThis.location) emailLinkLanding = landEmailLink(globalThis.location.href);
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
      // A signed-in device shows no sign-in screen to read it on, and after a
      // sign-out it would be news about a link nobody here just opened.
      if (session) emailLinkLanding = null;
      for (const listener of listeners) listener(event, session);
    });
  }
  return client;
}

/** What `src/sync/live.ts` needs to open its own Realtime client, beside this one. */
export function realtimeAccess(): { url: string; apiKey: string; accessToken: () => Promise<string | null> } | null {
  const supabase = getSupabase();
  if (!supabase) return null;
  return {
    url: url!,
    apiKey: anonKey!,
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  };
}

/** One Supabase listener for the app; a callback must not await auth work (Supabase's rule). */
export function subscribeSupabaseAuthEvents(listener: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  getSupabase();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The reset link's client, sharing nothing with the app's own. Unpersisted: the web mirrors a persisted
 * session to every tab, so a link opened beside a signed-in tab would hand that tab another account.
 * Implicit, so it needs no PKCE verifier; the e-mail's `token_hash` link is redeemed here with `verifyOtp`,
 * and so is a confirmation or e-mail change link's.
 */
export function createRecoveryClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit", storageKey: "gital-password-recovery" },
  });
}
