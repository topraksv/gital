/**
 * The account session (SPEC 9.1), Helix's `src/auth/session.ts`. The last
 * account signed in is kept on the device, so the app opens offline, and
 * Supabase refreshes the session when it can. Sync runs exactly while an
 * account is open here: this file starts it, and stops it before anything
 * empties the device under it.
 *
 * Where it departs (`docs/ARCHITECTURE.md`, 2026-09-26 and 2026-09-27): the
 * first account to sign in adopts the lists made before accounts; a session
 * Supabase ends by itself keeps what was never sent behind the sign-in
 * screen rather than wiping it; and no account signs in over another's lists
 * while any change is unsent.
 */

import { create } from "zustand";
import { Platform } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";

import { setAccountFrozen } from "../data/settings";
import { pendingOutboxCount, resetLocalWorkspace } from "../db/mutations";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { cancelReminders } from "../services/reminders";
import { flushOutbox, startSyncSession, stopSyncSession } from "../sync/engine";
import { purgeOwnPhotos } from "../sync/photos";
import { createRecoveryClient, getSupabase, subscribeSupabaseAuthEvents } from "../sync/supabase";
import { friendlyAuthError } from "./auth-errors";
import { loadPreviousLogin, recordSuccessfulLogin, seedCurrentLogin, startLoginHistory } from "./login-history";
import { HOSTED_RECOVERY_PAGE, parseRecoveryLink, recoveryPage, recoveryRedirect } from "./recovery";
import { IDLE_BRAKE, isVerificationBlocked, recordVerificationFailure, recordVerificationSuccess } from "./verification-brake";

/** The one account of a build with no Supabase, which runs on the device alone. */
export const LOCAL_USER_ID = "local";

/** The server's `minimum_password_length`, checked before asking so the form can say it. */
export const PASSWORD_MIN = 8;

/** Helix's shape check: enough to catch a slip, and the server decides the rest. */
export function isEmail(email: string): boolean {
  return /.+@.+\..+/.test(email.trim());
}

export function isValidNewPassword(password: string): boolean {
  return [...password].length >= PASSWORD_MIN;
}

/** Compared by identity, so the account screen offers "sign out anyway" instead of an error. */
export const SIGN_OUT_PENDING_CHANGES = tr.auth.signOutPending;

const LAST_USER_KEY = "gital.auth.last_user";
/** Kept so a password check still knows the address after an offline start. */
const LAST_EMAIL_KEY = "gital.auth.last_email";
/** Whose rows the database holds; absent means the lists from before accounts. */
const OWNER_KEY = "gital.auth.owner";
/** A deleted account whose wipe failed: whoever signs in next wipes first. */
const WIPE_PENDING = "__wipe_pending__";

let brake = IDLE_BRAKE;
let explicitSignOut = false;
let listening = false;
/** The session a reset link opened, on a client of its own, until the new password is saved. */
let recovery: SupabaseClient | null = null;
/** A reset link's token, held unspent until save: opening the page, or reloading it, spends nothing. */
let pendingRecoveryToken: string | null = null;

const signedOut = { userId: null, email: null, previousLoginAt: null } as const;

/** Catches for the convenience work `claim` describes. */
const ignore = () => {};
const absent = () => null;

/** Auth could not be reached, which is not the same as Auth saying no. */
const unreachable = (error: { name?: string } | null) => error?.name === "AuthRetryableFetchError";

function webPage(): { origin: string; baseUrl: string } | null {
  return Platform.OS === "web" && globalThis.location ? { origin: globalThis.location.origin, baseUrl: process.env.EXPO_BASE_URL ?? "" } : null;
}

/**
 * Prove the database is `userId`'s before the account opens on it. Read,
 * write and read back, as Helix does: a read that fails must not pass for "no
 * owner", which is the answer that skips a wipe, and on the web `kv` drops a
 * write the browser refuses, so only reading the marker back proves it landed.
 */
async function ensureWorkspaceFor(userId: string): Promise<string | null> {
  let owner: string | null;
  try {
    owner = await kv.get(OWNER_KEY);
  } catch {
    return tr.auth.errWorkspaceOwner;
  }
  if (owner === userId) return null;
  if (owner) {
    try {
      // Another account's lists may exist nowhere else yet. The one exception
      // is a deleted account's: nobody is left to send them to.
      if (owner !== WIPE_PENDING && (await pendingOutboxCount()) > 0) return tr.auth.errOtherAccountPending;
      await cancelReminders().catch(ignore);
      await resetLocalWorkspace();
    } catch {
      return tr.auth.errWorkspaceReset;
    }
  }
  const recorded = await kv
    .set(OWNER_KEY, userId)
    .then(() => kv.get(OWNER_KEY))
    .catch(absent);
  return recorded === userId ? null : tr.auth.errWorkspaceOwner;
}

/**
 * Open the account on this device once its workspace is proven its own, or
 * end the session Auth just gave. Past the proof, everything is convenience —
 * who to reopen offline, a date to show — and a store that refuses it costs
 * the convenience, never the session (Helix's lesson).
 */
async function claim(supabase: SupabaseClient, user: { id: string; email?: string }, email: string): Promise<string | null> {
  const refused = await ensureWorkspaceFor(user.id);
  if (refused) {
    await endAuthSession(supabase, "local");
    return refused;
  }
  await kv.set(LAST_USER_KEY, user.id).catch(ignore);
  await kv.set(LAST_EMAIL_KEY, user.email ?? email).catch(ignore);
  return null;
}

async function forgetAccount(): Promise<void> {
  for (const key of [OWNER_KEY, LAST_USER_KEY, LAST_EMAIL_KEY]) await kv.remove(key).catch(ignore);
}

/**
 * End the session on this device only, unless the account itself is going:
 * Supabase's default scope is global, and Helix's web sign-out ended the
 * phone's session with it. A refused revoke still clears it here, or the next
 * launch would find it.
 */
async function endAuthSession(supabase: SupabaseClient, scope: "local" | "global"): Promise<void> {
  explicitSignOut = true;
  try {
    const { error } = await supabase.auth.signOut({ scope }).catch((failure: unknown) => ({ error: failure }));
    if (error) await supabase.auth.signOut({ scope: "local" }).catch(ignore);
  } finally {
    explicitSignOut = false;
  }
}

/**
 * A session that ended without a sign-out — revoked, deleted elsewhere,
 * replaced — closes the app on the sign-in screen. Helix wipes the device
 * here, because its cloud holds the rows. So does Gital once nothing is
 * waiting to be sent; what is waiting may exist nowhere else, so it stays,
 * still owned, and only its account reopens it.
 */
async function closeEndedSession(): Promise<void> {
  useSession.setState(signedOut);
  await stopSyncSession();
  await kv.remove(LAST_USER_KEY).catch(ignore);
  await cancelReminders().catch(ignore);
  // A count that fails is not a zero.
  if ((await pendingOutboxCount().catch(ignore)) === 0) await resetLocalWorkspace().then(forgetAccount, ignore);
}

function listenForEndedSessions(): void {
  if (listening) return;
  listening = true;
  subscribeSupabaseAuthEvents((event) => {
    // Supabase warns against auth work inside its own callback.
    if (event === "SIGNED_OUT" && !explicitSignOut) queueMicrotask(() => void closeEndedSession());
  });
}

type SignUpResult = { status: "signed-in" } | { status: "confirmation-required" } | { status: "error"; message: string };

interface SessionStore {
  userId: string | null;
  email: string | null;
  /** False until the first launch has decided who, if anyone, is signed in. */
  ready: boolean;
  /** The sign-in before this session's, for the account screen. */
  previousLoginAt: string | null;
  /** This device is freezing the account, and signs out next: the gate stays shut. */
  isFreezing: boolean;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  /** Read a reset link and open its session; nothing is spent until the password is saved. */
  preparePasswordRecovery: (url: string | null) => Promise<"ready" | "expired" | "invalid" | "offline">;
  completePasswordRecovery: (newPassword: string) => Promise<string | null>;
  /** Empties the device. Refuses with `SIGN_OUT_PENDING_CHANGES` while a change is unsent, unless `force`. */
  signOut: (options?: { force?: boolean }) => Promise<string | null>;
  deleteAccount: () => Promise<string | null>;
  /** Lock the account on every device until a sign-in; frozen only once the server has it. */
  freezeAccount: () => Promise<string | null>;
  /** Confirm the password before a delete or a credential change; a run of failures pauses it. */
  verifyPassword: (password: string) => Promise<string | null>;
  changeEmail: (newEmail: string) => Promise<string | null>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
}

export const useSession = create<SessionStore>((set, get) => ({
  userId: null,
  email: null,
  ready: false,
  previousLoginAt: null,
  isFreezing: false,

  bootstrap: async () => {
    const supabase = getSupabase();
    if (!supabase) {
      set({ userId: LOCAL_USER_ID, ready: true });
      return;
    }
    listenForEndedSessions();
    let offline = false;
    try {
      const { data, error } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (user) {
        if (await claim(supabase, user, "")) {
          set({ ...signedOut, ready: true });
          return;
        }
        await seedCurrentLogin(kv, user.id, user.last_sign_in_at ?? new Date().toISOString()).catch(ignore);
        startSyncSession(user.id);
        set({ userId: user.id, email: user.email ?? null, ready: true, previousLoginAt: await loadPreviousLogin(kv, user.id).catch(absent) });
        return;
      }
      offline = unreachable(error);
    } catch {
      offline = true;
    }
    // Only an unreachable Auth reopens the last account. One that answered
    // with no session has refused it, and reopening it would hide that.
    const lastUser = offline ? await kv.get(LAST_USER_KEY).catch(absent) : null;
    if (lastUser && !(await ensureWorkspaceFor(lastUser))) {
      startSyncSession(lastUser);
      set({
        userId: lastUser,
        email: await kv.get(LAST_EMAIL_KEY).catch(absent),
        ready: true,
        previousLoginAt: await loadPreviousLogin(kv, lastUser).catch(absent),
      });
      return;
    }
    set({ ...signedOut, ready: true });
  },

  signIn: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return tr.auth.errNotConfigured;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return friendlyAuthError(error.message);
    const refused = await claim(supabase, data.user, email);
    if (refused) return refused;
    const previousLoginAt = await recordSuccessfulLogin(kv, data.user.id, data.user.last_sign_in_at ?? new Date().toISOString()).catch(absent);
    // Signing in is the password check, so it reopens a frozen account: a
    // write newer than the freeze, which the gate on every device follows.
    await setAccountFrozen(false).catch(ignore);
    startSyncSession(data.user.id);
    set({ userId: data.user.id, email: data.user.email ?? email, previousLoginAt });
    return null;
  },

  signUp: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return { status: "error", message: tr.auth.errNotConfigured };
    if (!isValidNewPassword(password)) return { status: "error", message: tr.auth.errWeakPassword };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user) return { status: "error", message: friendlyAuthError(error?.message ?? "") };
    // With confirmation on, Auth gives no session until the address is
    // proven, and the workspace is claimed by the sign-in that follows.
    if (!data.session) return { status: "confirmation-required" };
    const refused = await claim(supabase, data.user, email);
    if (refused) return { status: "error", message: refused };
    await startLoginHistory(kv, data.user.id, new Date().toISOString()).catch(ignore);
    startSyncSession(data.user.id);
    set({ userId: data.user.id, email: data.user.email ?? email, previousLoginAt: null });
    return { status: "signed-in" };
  },

  requestPasswordReset: async (email) => {
    const client = createRecoveryClient();
    if (!client) return tr.auth.errNotConfigured;
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirect(webPage()) });
    // An address with no account reads as sent, so the form never says which addresses have one.
    if (!error || /user.*not found|email.*not found/i.test(error.message)) return null;
    return friendlyAuthError(error.message);
  },

  preparePasswordRecovery: async (url) => {
    recovery = null;
    pendingRecoveryToken = null;
    const web = webPage();
    const link = parseRecoveryLink(url, web ? recoveryPage(web.origin, web.baseUrl) : HOSTED_RECOVERY_PAGE);
    if (link.kind === "tokenHash") {
      pendingRecoveryToken = link.tokenHash;
      return "ready";
    }
    if (link.kind !== "session") return link.kind;
    const client = createRecoveryClient();
    if (!client) return "invalid";
    const { error } = await client.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
    if (error) return unreachable(error) ? "offline" : "invalid";
    recovery = client;
    return "ready";
  },

  completePasswordRecovery: async (newPassword) => {
    if (!recovery && !pendingRecoveryToken) return tr.auth.resetInvalidBody;
    if (!isValidNewPassword(newPassword)) return tr.auth.errWeakPassword;
    if (!recovery) {
      // Redeemed on a client of its own, needing no PKCE verifier, so the link
      // works in whichever browser the mail app opens and touches nothing this
      // device is signed in with.
      const client = createRecoveryClient();
      if (!client) return tr.auth.errNotConfigured;
      const { error } = await client.auth.verifyOtp({ token_hash: pendingRecoveryToken!, type: "recovery" });
      // A request that never reached Auth spent nothing; Auth's refusal is final.
      if (unreachable(error)) return friendlyAuthError(error!.message);
      pendingRecoveryToken = null;
      if (error) return error.code === "otp_expired" ? tr.auth.resetExpiredBody : tr.auth.resetInvalidBody;
      recovery = client;
    }
    // A refused save keeps the session, so the next press needs no new link.
    const { error } = await recovery.auth.updateUser({ password: newPassword });
    if (error) return friendlyAuthError(error.message);
    await recovery.auth.signOut({ scope: "local" }).catch(ignore);
    recovery = null;
    return null;
  },

  signOut: async (options) => {
    // A build with no accounts has nothing to sign out of, and its lists no other copy.
    const supabase = getSupabase();
    if (!supabase) return tr.auth.errNotConfigured;
    const userId = get().userId;
    // Send what is waiting first, so the question is asked only about what truly cannot leave.
    if (userId) await flushOutbox(userId);
    if (!options?.force && (await pendingOutboxCount()) > 0) return SIGN_OUT_PENDING_CHANGES;
    await stopSyncSession();
    await cancelReminders().catch(ignore);
    try {
      await resetLocalWorkspace();
    } catch {
      if (userId) startSyncSession(userId);
      return tr.auth.errWorkspaceReset;
    }
    set(signedOut);
    await endAuthSession(supabase, "local");
    await forgetAccount();
    return null;
  },

  freezeAccount: async () => {
    const userId = get().userId;
    if (!getSupabase() || !userId) return tr.auth.errNotConfigured;
    set({ isFreezing: true });
    try {
      // The sign-out sends everything first and refuses while anything is
      // unsent, so its success is the proof that the freeze reached the server.
      await setAccountFrozen(true);
      const refused = await get().signOut().catch(() => tr.account.freezeSyncFailed);
      if (!refused) return null;
      // Helix's lesson: a failure after the flag must put it back, or every launch opens on the gate.
      if (!(await setAccountFrozen(false).then(() => true, () => false))) return tr.account.freezeRollbackFailed;
      return refused === SIGN_OUT_PENDING_CHANGES ? tr.account.freezeSyncFailed : refused;
    } finally {
      set({ isFreezing: false });
    }
  },

  deleteAccount: async () => {
    const supabase = getSupabase();
    const userId = get().userId;
    if (!supabase || !userId) return tr.auth.errNotConfigured;
    // Nothing is sent while the account is taken apart. Its photos go first,
    // since nothing cascades to Storage; then the account, and if the server
    // keeps it, the device keeps everything and sync sends the photos back.
    await stopSyncSession();
    let error: { message: string } | null;
    try {
      await purgeOwnPhotos();
      ({ error } = await supabase.rpc("delete_own_account"));
    } catch (failure) {
      error = { message: failure instanceof Error ? failure.message : String(failure) };
    }
    if (error) {
      startSyncSession(userId);
      const friendly = friendlyAuthError(error.message);
      return friendly === tr.auth.errSessionExpired ? friendly : tr.account.deleteCloudFailed;
    }
    await cancelReminders().catch(ignore);
    // The identity is gone, so every device's session goes with it: the one global revoke.
    await endAuthSession(supabase, "global");
    try {
      await resetLocalWorkspace();
    } catch {
      set(signedOut);
      await kv.set(OWNER_KEY, WIPE_PENDING).catch(ignore);
      await kv.remove(LAST_USER_KEY).catch(ignore);
      return tr.account.deleteWipeFailed;
    }
    set(signedOut);
    await forgetAccount();
    return null;
  },

  verifyPassword: async (password) => {
    const supabase = getSupabase();
    const owner = get().userId;
    if (!supabase || !owner) return tr.auth.errNotConfigured;
    if (isVerificationBlocked(brake, owner, Date.now())) return tr.auth.errRateLimit;
    // After an offline start the store has no address; Auth or the device may.
    let email = get().email;
    if (!email) {
      email = (await supabase.auth.getUser().catch(absent))?.data.user?.email ?? (await kv.get(LAST_EMAIL_KEY).catch(absent));
      if (!email) return tr.auth.errSessionExpired;
      set({ email });
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      brake = recordVerificationFailure(brake, owner, Date.now());
      return /invalid login credentials|invalid_credentials/i.test(error.message) ? tr.account.wrongPassword : friendlyAuthError(error.message);
    }
    if (data.user.id !== owner) {
      // The address was another account's, whose session just replaced this
      // one's: end it, and let this account sign in again to its own lists.
      await endAuthSession(supabase, "local");
      await closeEndedSession();
      return tr.auth.errSessionExpired;
    }
    brake = recordVerificationSuccess(brake, owner);
    return null;
  },

  changeEmail: async (newEmail) => {
    const supabase = getSupabase();
    if (!supabase) return tr.auth.errNotConfigured;
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    return error ? friendlyAuthError(error.message) : null;
  },

  changePassword: async (currentPassword, newPassword) => {
    const supabase = getSupabase();
    if (!supabase) return tr.auth.errNotConfigured;
    if (!isValidNewPassword(newPassword)) return tr.auth.errWeakPassword;
    const { error } = await supabase.auth.updateUser({ current_password: currentPassword, password: newPassword });
    return error ? friendlyAuthError(error.message) : null;
  },
}));
