/**
 * A sign-up confirmation or e-mail change link, landing on the Site URL with
 * its token unspent. It is read before the app's client exists, and redeemed
 * on a client of its own: the account it confirms may not be the one this
 * device is signed in with, and confirming it signs nobody in here. Only
 * Auth's answer is reported as "confirmed".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const callbacks: ((event: string, session: unknown) => void)[] = [];
  const client = {
    auth: {
      verifyOtp: vi.fn(async (_request: { token_hash: string; type: string }) => ({ error: null as { name?: string; message: string } | null })),
      signOut: vi.fn(async (_options: { scope: string }) => ({ error: null })),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        callbacks.push(callback);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  return { callbacks, client, platform: { OS: "web" } };
});

vi.mock("react-native", () => ({ Platform: harness.platform }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => harness.client) }));

const site = "https://topraksv.github.io/gital/";

/** A fresh copy of the module, so its client and landing start empty. */
async function load() {
  vi.resetModules();
  harness.callbacks.length = 0;
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "publishable-test-key");
  const module = await import("../../src/sync/supabase");
  const { createClient } = await import("@supabase/supabase-js");
  vi.mocked(createClient).mockClear();
  return { ...module, createClient: vi.mocked(createClient) };
}

function emitter() {
  const emit = harness.callbacks[0];
  if (!emit || harness.callbacks.length !== 1) throw new Error("expected exactly one Supabase auth listener");
  return emit;
}

describe("an e-mail link landing on the Site URL", () => {
  const replaceState = vi.fn();

  beforeEach(() => {
    harness.platform.OS = "web";
    vi.stubGlobal("history", { state: { key: 1 }, replaceState });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    replaceState.mockClear();
    harness.client.auth.verifyOtp.mockClear();
    harness.client.auth.signOut.mockClear();
  });

  it("confirms a sign-up token with Auth, once, on a client that keeps nothing", async () => {
    vi.stubGlobal("location", { href: `${site}?token_hash=pkce_0b6f&type=email` });
    const web = await load();
    expect(web.takeEmailLinkLanding()).toBeNull();
    web.getSupabase();
    // Out of the address bar before anything else runs: a reload must not
    // spend the same token a second time and report the refusal.
    expect(replaceState).toHaveBeenCalledWith({ key: 1 }, "", site);
    await expect(web.takeEmailLinkLanding()).resolves.toBe("confirmed");
    expect(web.takeEmailLinkLanding()).toBeNull();
    expect(harness.client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "pkce_0b6f", type: "email" });
    expect(harness.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(web.createClient).toHaveBeenCalledTimes(2);
    expect(web.createClient.mock.calls[0]?.[2]).toMatchObject({ auth: { persistSession: false } });
  });

  // One side of a change is not the change: with both addresses asked, Auth
  // accepts the first link and still waits for the other.
  it("confirms one side of an e-mail change, and says only that", async () => {
    vi.stubGlobal("location", { href: `${site}?token_hash=pkce_7c1d&type=email_change` });
    const change = await load();
    change.getSupabase();
    await expect(change.takeEmailLinkLanding()).resolves.toBe("changeConfirmed");
    expect(harness.client.auth.verifyOtp).toHaveBeenLastCalledWith({ token_hash: "pkce_7c1d", type: "email_change" });
  });

  it("reports a used or expired token as a link that no longer works", async () => {
    harness.client.auth.verifyOtp.mockResolvedValueOnce({ error: { message: "Token has expired or is invalid" } });
    vi.stubGlobal("location", { href: `${site}?token_hash=pkce_0b6f&type=email` });
    const refused = await load();
    refused.getSupabase();
    await expect(refused.takeEmailLinkLanding()).resolves.toBe("unusable");
    expect(harness.client.auth.signOut).not.toHaveBeenCalled();

    // Auth's own verify link, from a mail sent before the template moved, refusing.
    vi.stubGlobal("location", { href: `${site}#error=access_denied&error_code=otp_expired` });
    const expired = await load();
    expired.getSupabase();
    await expect(expired.takeEmailLinkLanding()).resolves.toBe("unusable");
  });

  it("keeps a link a dropped connection never delivered, for a reload", async () => {
    harness.client.auth.verifyOtp.mockResolvedValueOnce({ error: { name: "AuthRetryableFetchError", message: "Failed to fetch" } });
    const href = `${site}?token_hash=pkce_0b6f&type=email`;
    vi.stubGlobal("location", { href });
    const offline = await load();
    offline.getSupabase();
    await expect(offline.takeEmailLinkLanding()).resolves.toBe("offline");
    expect(replaceState).toHaveBeenLastCalledWith({ key: 1 }, "", href);
    expect(harness.client.auth.signOut).not.toHaveBeenCalled();
  });

  // A mail sent before the template moved returns a PKCE code, which the app's
  // own client redeems in the browser that signed up; nothing here may claim it.
  it("leaves an old link's code, and any other address, to the app's own client", async () => {
    for (const href of [`${site}?code=0b6f`, `${site}?tab=listeler`]) {
      vi.stubGlobal("location", { href });
      const ordinary = await load();
      expect(ordinary.getSupabase()).toBe(harness.client);
      expect(ordinary.takeEmailLinkLanding(), href).toBeNull();
    }
    expect(replaceState).not.toHaveBeenCalled();
    expect(harness.client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("reads no landing on a phone, nor without an address", async () => {
    // A native build has no address bar; a location stubbed onto it is not one.
    vi.stubGlobal("location", { href: `${site}?token_hash=pkce_0b6f&type=email` });
    harness.platform.OS = "ios";
    const native = await load();
    native.getSupabase();
    expect(native.takeEmailLinkLanding()).toBeNull();

    harness.platform.OS = "web";
    vi.stubGlobal("location", undefined);
    const bare = await load();
    expect(() => bare.getSupabase()).not.toThrow();
    expect(bare.takeEmailLinkLanding()).toBeNull();
  });

  // A signed-in device has no sign-in screen to show it on; after a sign-out
  // it would greet the next person with news about somebody else's link.
  it("drops an unread landing once a session exists", async () => {
    vi.stubGlobal("location", { href: `${site}#error_code=otp_expired` });
    const web = await load();
    web.getSupabase();
    emitter()("INITIAL_SESSION", null);
    await expect(web.takeEmailLinkLanding()).resolves.toBe("unusable");

    const signedIn = await load();
    signedIn.getSupabase();
    emitter()("SIGNED_IN", { user: { id: "user-b" } });
    expect(signedIn.takeEmailLinkLanding()).toBeNull();
  });
});
