/**
 * The account session (SPEC 9.1) over a stubbed Supabase and the real write
 * layer on Node's SQLite, the sync engine replaced by a recorder. Helix's
 * rules hold — a workspace belongs to one account, sync runs only while its
 * account is open, a sign-out sends what is waiting and asks before it
 * destroys what could not leave, a deleted account leaves nothing behind —
 * with Gital's two departures: the first account adopts the lists made
 * before accounts, and a session Supabase ends keeps what was never sent
 * behind sign-in rather than wiping it.
 */

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CloudUser {
  id: string;
  email: string;
  password: string;
}

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
const device = vi.hoisted(() => ({
  os: "ios",
  stored: new Map<string, string>(),
  /** Keys a blocked store drops on write, as a browser with site data off does. */
  dropped: new Set<string>(),
  /** Keys whose every read and write throws, as a locked keychain does. */
  failing: new Set<string>(),
  /** Keys whose next read throws, and the one after answers. */
  readFailsOnce: new Set<string>(),
  cancelled: 0,
}));
const cloud = vi.hoisted(() => ({
  configured: true,
  users: [] as CloudUser[],
  session: null as { user: { id: string; email: string; last_sign_in_at?: string } } | null,
  sessionError: null as { name: string; message: string } | null,
  rpcError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  signUpError: null as { message: string } | null,
  resetError: null as { message: string } | null,
  setSessionError: null as { name: string; message: string } | null,
  signUpSession: true,
  /** A client that throws instead of answering, as a fetch polyfill can. */
  throws: false,
  calls: [] as string[],
  listeners: new Set<(event: string) => void>(),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return device.os;
    },
  },
}));
vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});
vi.mock("expo-crypto", async () => {
  const { createHash } = await import("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex"),
  };
});
vi.mock("../../src/services/kv", () => {
  const reach = (key: string) => {
    if ([...device.failing].some((prefix) => key.startsWith(prefix))) throw new Error("keychain locked");
  };
  return {
    kv: {
      get: async (key: string) => {
        reach(key);
        if (device.readFailsOnce.delete(key)) throw new Error("keychain busy");
        return device.stored.get(key) ?? null;
      },
      set: async (key: string, value: string) => void (reach(key), device.dropped.has(key) || device.stored.set(key, value)),
      remove: async (key: string) => void (reach(key), device.stored.delete(key)),
    },
  };
});
vi.mock("../../src/services/reminders", () => ({ cancelReminders: async () => void device.cancelled++ }));
const sync = vi.hoisted(() => ({
  calls: [] as string[],
  flushSends: false,
  purgeFails: false,
  /** What a flush that sends took from the outbox. */
  sent: [] as Record<string, unknown>[],
  onFlush: null as (() => void) | null,
}));
vi.mock("../../src/sync/engine", () => ({
  startSyncSession: (userId: string) => void sync.calls.push(`start:${userId}`),
  stopSyncSession: async () => void sync.calls.push("stop"),
  flushOutbox: async () => {
    sync.calls.push("flush");
    sync.onFlush?.();
    if (!sync.flushSends) return;
    const waiting = harness.db!.prepare("SELECT payload FROM outbox ORDER BY id").all() as { payload: string }[];
    sync.sent.push(...waiting.map(({ payload }) => JSON.parse(payload) as Record<string, unknown>));
    harness.db!.exec("DELETE FROM outbox");
  },
}));
vi.mock("../../src/sync/photos", () => ({
  purgeOwnPhotos: async () => {
    cloud.calls.push("photos:purge");
    if (sync.purgeFails) throw new Error("Failed to fetch");
  },
}));
vi.mock("../../src/sync/supabase", () => {
  const user = (found: CloudUser) => ({ id: found.id, email: found.email, last_sign_in_at: "2026-09-26T09:00:00.000Z" });
  const client = {
    auth: {
      getSession: async () => {
        if (cloud.throws) throw new TypeError("Network request failed");
        return { data: { session: cloud.session }, error: cloud.sessionError };
      },
      getUser: async () => ({ data: { user: cloud.session?.user ?? null } }),
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const found = cloud.users.find((candidate) => candidate.email === email && candidate.password === password);
        if (!found) return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
        cloud.session = { user: user(found) };
        return { data: { user: user(found), session: cloud.session }, error: null };
      },
      signUp: async ({ email, password }: { email: string; password: string }) => {
        if (cloud.signUpError) return { data: { user: null, session: null }, error: cloud.signUpError };
        const created = { id: `u-${email}`, email, password };
        cloud.users.push(created);
        cloud.session = cloud.signUpSession ? { user: user(created) } : null;
        return { data: { user: user(created), session: cloud.session }, error: null };
      },
      signOut: async ({ scope }: { scope: string }) => {
        cloud.calls.push(`signOut:${scope}`);
        if (cloud.throws) throw new TypeError("Network request failed");
        cloud.session = null;
        // A global revoke after the account is deleted finds no user to revoke.
        return { error: scope === "global" ? { message: "User not found" } : null };
      },
      updateUser: async (change: Record<string, string>) => {
        cloud.calls.push(`updateUser:${Object.keys(change).sort().join(",")}`);
        return { error: cloud.updateError };
      },
    },
    rpc: async (name: string) => {
      cloud.calls.push(`rpc:${name}`);
      return { error: cloud.rpcError };
    },
  };
  const recovery = {
    auth: {
      resetPasswordForEmail: async (email: string, { redirectTo }: { redirectTo: string }) => {
        cloud.calls.push(`reset:${email}:${redirectTo}`);
        return { error: cloud.resetError };
      },
      setSession: async ({ access_token }: { access_token: string }) => {
        cloud.calls.push(`recovery:setSession:${access_token}`);
        return { error: cloud.setSessionError };
      },
      updateUser: async () => {
        cloud.calls.push("recovery:updateUser");
        return { error: cloud.updateError };
      },
      signOut: async () => {
        cloud.calls.push("recovery:signOut");
        return { error: null };
      },
    },
  };
  return {
    get isSupabaseConfigured() {
      return cloud.configured;
    },
    getSupabase: () => (cloud.configured ? client : null),
    createRecoveryClient: () => (cloud.configured ? recovery : null),
    subscribeSupabaseAuthEvents: (listener: (event: string) => void) => {
      cloud.listeners.add(listener);
      return () => cloud.listeners.delete(listener);
    },
  };
});

const { LOCAL_USER_ID, SIGN_OUT_PENDING_CHANGES, useSession } = await import("../../src/auth/session");
const { HOSTED_RECOVERY_PAGE } = await import("../../src/auth/recovery");
const { VERIFY_COOLDOWN_MS, VERIFY_MAX_FAILURES } = await import("../../src/auth/verification-brake");
const { createList, readLists } = await import("../../src/data/lists");
const { photoColumn } = await import("../../src/data/photos");
const { frozenFrom, isFrozen, readSettings, setAccountFrozen } = await import("../../src/data/settings");
const { tr } = await import("../../src/i18n/tr");
const { migratedDatabase } = await import("../helpers");

const OWNER = "gital.auth.owner";
const LAST_USER = "gital.auth.last_user";
const LAST_EMAIL = "gital.auth.last_email";
const A: CloudUser = { id: "user-a", email: "a@ev.com", password: "parola-a1" };
const B: CloudUser = { id: "user-b", email: "b@ev.com", password: "parola-b1" };

const session = () => useSession.getState();
const count = (table: string) => Number((harness.db!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
const sent = () => harness.db!.exec("DELETE FROM outbox");
/** Let the auth listener's deferred work run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  harness.db = migratedDatabase();
  device.os = "ios";
  device.stored.clear();
  device.dropped.clear();
  device.failing.clear();
  device.readFailsOnce.clear();
  device.cancelled = 0;
  Object.assign(cloud, { configured: true, users: [A, B], session: null, sessionError: null, rpcError: null, updateError: null, signUpError: null, resetError: null, setSessionError: null, signUpSession: true, throws: false, calls: [] });
  Object.assign(sync, { calls: [], flushSends: false, purgeFails: false, sent: [], onFlush: null });
  useSession.setState({ userId: null, email: null, ready: false, previousLoginAt: null });
});

describe("whose lists the device holds", () => {
  it("gives the lists made before accounts to the first account that signs in", async () => {
    await createList("Market");
    expect(await session().signIn(A.email, A.password)).toBeNull();
    expect(session()).toMatchObject({ userId: A.id, email: A.email });
    expect((await readLists()).map((list) => list.name)).toEqual(["Market"]);
    expect(device.stored.get(OWNER)).toBe(A.id);
    expect(device.stored.get(LAST_USER)).toBe(A.id);
    expect(sync.calls, "and syncs them under it").toEqual([`start:${A.id}`]);
  });

  it("will not let another account sign in over lists never sent, and empties the device once they were", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    await photoColumn({ data: "data:image/jpeg;base64,AA", thumb: "data:image/jpeg;base64,AA" });
    useSession.setState({ userId: null });

    expect(await session().signIn(B.email, B.password)).toBe(tr.auth.errOtherAccountPending);
    expect(cloud.calls).toContain("signOut:local");
    expect(session().userId).toBeNull();
    expect(count("lists")).toBe(1);

    sent();
    expect(await session().signIn(B.email, B.password)).toBeNull();
    expect([count("lists"), count("photos")]).toEqual([0, 0]);
    expect(count("outbox"), "B's own sign-in, and nothing of A's").toBe(1);
    expect(device.stored.get(OWNER)).toBe(B.id);
    expect(device.cancelled).toBe(1);
  });

  it("refuses a sign-in whose ownership it could not record, or read", async () => {
    device.dropped.add(OWNER);
    expect(await session().signIn(A.email, A.password)).toBe(tr.auth.errWorkspaceOwner);
    expect(session().userId).toBeNull();
    expect(cloud.calls).toEqual(["signOut:local"]);
    // A read that fails is not "no owner", the answer that would skip the
    // wipe and hand one account's lists to the next.
    device.dropped.clear();
    await session().signIn(A.email, A.password);
    await createList("Market");
    sent();
    useSession.setState({ userId: null });
    device.readFailsOnce.add(OWNER);
    expect(await session().signIn(B.email, B.password)).toBe(tr.auth.errWorkspaceOwner);
    expect([count("lists"), device.stored.get(OWNER)]).toEqual([1, A.id]);
  });

  it("opens the account though the device will not remember it, which then cannot reopen offline", async () => {
    device.failing.add(LAST_USER).add(LAST_EMAIL).add("gital.login.");
    expect(await session().signIn(A.email, A.password)).toBeNull();
    expect(session()).toMatchObject({ userId: A.id, email: A.email, previousLoginAt: null });

    useSession.setState({ userId: null, ready: false });
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: A.id, previousLoginAt: null });

    useSession.setState({ userId: null, ready: false });
    cloud.session = null;
    cloud.sessionError = { name: "AuthRetryableFetchError", message: "Failed to fetch" };
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: null });
  });

  it("names a wrong password in Turkish", async () => {
    expect(await session().signIn(A.email, "yanlis-parola")).toBe(tr.auth.errInvalidCredentials);
  });
});

describe("opening the app", () => {
  it("opens a live session's own workspace, with the sign-in before it", async () => {
    cloud.session = { user: { id: A.id, email: A.email, last_sign_in_at: "2026-09-26T09:00:00.000Z" } };
    device.stored.set(OWNER, A.id);
    device.stored.set(`gital.login.current.${A.id}`, "2026-09-25T08:00:00.000Z");
    device.stored.set(`gital.login.previous.${A.id}`, "2026-09-24T08:00:00.000Z");
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: A.id, email: A.email, previousLoginAt: "2026-09-24T08:00:00.000Z" });
    expect(sync.calls).toEqual([`start:${A.id}`]);
  });

  it("opens the last account offline, and nobody once Auth has refused the session", async () => {
    device.stored.set(OWNER, A.id);
    device.stored.set(LAST_USER, A.id);
    device.stored.set(LAST_EMAIL, A.email);
    cloud.sessionError = { name: "AuthRetryableFetchError", message: "Failed to fetch" };
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: A.id, email: A.email });
    expect(sync.calls, "offline too: it syncs once the network is back").toEqual([`start:${A.id}`]);

    useSession.setState({ userId: null, ready: false });
    cloud.sessionError = null;
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: null });
  });

  it("takes a client that throws for one that cannot reach Auth", async () => {
    device.stored.set(OWNER, A.id);
    device.stored.set(LAST_USER, A.id);
    cloud.throws = true;
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: A.id });
    // The revoke throws too, and the device still ends up signed out.
    expect(await session().signOut()).toBeNull();
    expect(session().userId).toBeNull();
    expect(cloud.calls).toEqual(["signOut:local", "signOut:local"]);
  });

  it("signs a session out whose workspace belongs to lists another account never sent", async () => {
    device.stored.set(OWNER, A.id);
    await createList("Market");
    cloud.session = { user: { id: B.id, email: B.email } };
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: null });
    expect(cloud.calls).toEqual(["signOut:local"]);
  });

  it("runs on the device as one local account when the build has no Supabase, adopting nothing", async () => {
    cloud.configured = false;
    await session().bootstrap();
    expect(session()).toMatchObject({ ready: true, userId: LOCAL_USER_ID });
    expect(device.stored.has(OWNER)).toBe(false);
    expect(sync.calls, "with no server there is nothing to sync with").toEqual([]);
    for (const refused of [
      session().signIn(A.email, A.password),
      session().signUp(A.email, A.password).then((result) => result.status === "error" && result.message),
      session().requestPasswordReset(A.email),
      session().signOut({ force: true }),
      session().deleteAccount(),
      session().verifyPassword(A.password),
      session().changeEmail(A.email),
      session().changePassword(A.password, "yeni-parola1"),
    ]) {
      expect(await refused).toBe(tr.auth.errNotConfigured);
    }
    expect(await session().preparePasswordRecovery(`${HOSTED_RECOVERY_PAGE}#access_token=a&refresh_token=r&type=recovery`)).toBe("invalid");
  });

  it("keeps what was never sent behind sign-in when Supabase ends the session by itself", async () => {
    await session().bootstrap();
    await session().signIn(A.email, A.password);
    await createList("Market");
    for (const listener of cloud.listeners) listener("SIGNED_OUT");
    await settle();
    expect(session().userId).toBeNull();
    expect(sync.calls).toEqual([`start:${A.id}`, "stop"]);
    expect(count("lists")).toBe(1);
    expect(device.stored.has(LAST_USER)).toBe(false);
    expect(device.stored.get(OWNER)).toBe(A.id);
    expect(device.cancelled).toBe(1);

    for (const listener of cloud.listeners) listener("TOKEN_REFRESHED");
    await session().signIn(A.email, A.password);
    expect((await readLists()).map((list) => list.name)).toEqual(["Market"]);
  });

  it("empties the device when Supabase ends a session whose lists the server already holds", async () => {
    await session().bootstrap();
    await session().signIn(A.email, A.password);
    await createList("Market");
    sent();
    for (const listener of cloud.listeners) listener("SIGNED_OUT");
    await vi.waitFor(() => expect(count("lists")).toBe(0));
    expect(session().userId).toBeNull();
    for (const key of [OWNER, LAST_USER, LAST_EMAIL]) expect(device.stored.has(key)).toBe(false);
  });
});

describe("creating an account", () => {
  it("opens a new account at once when Auth gives it a session, with no sign-in before", async () => {
    expect(await session().signUp("c@ev.com", "yeni-parola1")).toEqual({ status: "signed-in" });
    expect(session()).toMatchObject({ userId: "u-c@ev.com", email: "c@ev.com", previousLoginAt: null });
    expect(device.stored.get(OWNER)).toBe("u-c@ev.com");
  });

  it("waits for the address to be confirmed, and refuses a short password before asking", async () => {
    cloud.signUpSession = false;
    expect(await session().signUp("c@ev.com", "yeni-parola1")).toEqual({ status: "confirmation-required" });
    expect(session().userId).toBeNull();
    expect(await session().signUp("d@ev.com", "kisa")).toEqual({ status: "error", message: tr.auth.errWeakPassword });
    expect(cloud.users.map((user) => user.email)).not.toContain("d@ev.com");
    cloud.signUpError = { message: "User already registered" };
    expect(await session().signUp(A.email, "yeni-parola1")).toEqual({ status: "error", message: tr.auth.errUserExists });
  });
});

describe("signing out", () => {
  it("sends what is waiting first, and then has nothing to ask", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    sync.flushSends = true;
    expect(await session().signOut()).toBeNull();
    expect(sync.calls, "sync stops before the device is emptied under it").toEqual([`start:${A.id}`, "flush", "stop"]);
    expect(count("lists")).toBe(0);
  });

  it("asks before destroying what could not be sent, then empties the device", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    expect(await session().signOut()).toBe(SIGN_OUT_PENDING_CHANGES);
    expect(session().userId).toBe(A.id);
    expect(count("lists")).toBe(1);

    expect(await session().signOut({ force: true })).toBeNull();
    expect(session().userId).toBeNull();
    expect([count("lists"), count("outbox")]).toEqual([0, 0]);
    // Only this device: the phone stays signed in when the web signs out.
    expect(cloud.calls).toEqual(["signOut:local"]);
    for (const key of [OWNER, LAST_USER, LAST_EMAIL]) expect(device.stored.has(key)).toBe(false);
    expect(device.cancelled).toBe(1);
  });

  it("keeps everything, the account still signed in, when the device cannot be emptied", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    harness.db!.exec("CREATE TRIGGER stuck BEFORE DELETE ON lists BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END");
    const waiting = count("outbox");
    expect(await session().signOut({ force: true })).toBe(tr.auth.errWorkspaceReset);
    expect(session().userId).toBe(A.id);
    expect([count("lists"), count("outbox")]).toEqual([1, waiting]);
    expect(cloud.calls).toEqual([]);
    expect(sync.calls.at(-1), "still signed in, so still syncing").toBe(`start:${A.id}`);

    // Nor does another account's sign-in go ahead over lists it could not clear.
    useSession.setState({ userId: null });
    sent();
    expect(await session().signIn(B.email, B.password)).toBe(tr.auth.errWorkspaceReset);
    expect(device.stored.get(OWNER)).toBe(A.id);
  });

  it("signs out without asking when nothing is waiting", async () => {
    await session().signIn(A.email, A.password);
    sent();
    expect(await session().signOut()).toBeNull();
    expect(session().userId).toBeNull();
  });
});

describe("freezing the account", () => {
  const frozenSent = () => sync.sent.filter((payload) => payload.key === "account_frozen").map((payload) => payload.value);

  it("locks nothing until the device knows, and opens the app on a read that failed", () => {
    const frozen = [{ key: "account_frozen", value: "true" }];
    expect(frozenFrom({ data: [], status: "loading", updatedAt: undefined })).toBeNull();
    expect(frozenFrom({ data: frozen, status: "ready", updatedAt: new Date() })).toBe(true);
    expect(frozenFrom({ data: [{ key: "account_frozen", value: "false" }], status: "stale", updatedAt: new Date() })).toBe(false);
    expect(frozenFrom({ data: [], status: "error", updatedAt: undefined })).toBe(false);
  });

  it("sends the freeze with everything else, then signs out", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    sync.flushSends = true;
    expect(await session().freezeAccount()).toBeNull();
    expect(frozenSent().at(-1)).toBe("true");
    expect(session()).toMatchObject({ userId: null, isFreezing: false });
    expect(count("lists")).toBe(0);
  });

  it("freezes nothing, and keeps the account open, when what waits cannot be sent", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    expect(await session().freezeAccount()).toBe(tr.account.freezeSyncFailed);
    expect(session()).toMatchObject({ userId: A.id, isFreezing: false });
    expect(isFrozen(await readSettings())).toBe(false);
    expect(count("lists")).toBe(1);
  });

  it("puts the flag back when the device cannot be emptied, and says why", async () => {
    await session().signIn(A.email, A.password);
    sync.flushSends = true;
    harness.db!.exec("CREATE TRIGGER stuck BEFORE DELETE ON lists BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END");
    await createList("Market");
    sent();
    expect(await session().freezeAccount()).toBe(tr.auth.errWorkspaceReset);
    expect(isFrozen(await readSettings())).toBe(false);
  });

  it("puts the flag back when the sign-out fails outright", async () => {
    await session().signIn(A.email, A.password);
    sync.onFlush = () => {
      throw new Error("Failed to fetch");
    };
    expect(await session().freezeAccount()).toBe(tr.account.freezeSyncFailed);
    expect(session()).toMatchObject({ userId: A.id, isFreezing: false });
    expect(isFrozen(await readSettings())).toBe(false);
  });

  it("says so when the flag cannot be put back, since every launch here opens on the lock", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    sync.onFlush = () => harness.db!.exec("CREATE TRIGGER stuck BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END");
    expect(await session().freezeAccount()).toBe(tr.account.freezeRollbackFailed);
    expect(isFrozen(await readSettings())).toBe(true);
  });

  it("has nothing to freeze while signed out", async () => {
    expect(await session().freezeAccount()).toBe(tr.auth.errNotConfigured);
  });

  it("holds the gate back on this device while it freezes", async () => {
    await session().signIn(A.email, A.password);
    sync.flushSends = true;
    let freezing: boolean | undefined;
    sync.onFlush = () => (freezing = session().isFreezing);
    await session().freezeAccount();
    expect(freezing).toBe(true);
  });

  it("is reopened by signing in, which is the password check", async () => {
    await session().signIn(A.email, A.password);
    await setAccountFrozen(true);
    useSession.setState({ userId: null });
    await session().signIn(A.email, A.password);
    expect(isFrozen(await readSettings())).toBe(false);
  });
});

describe("deleting the account", () => {
  it("deletes nothing on the device when the server could not delete the account", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    cloud.rpcError = { message: "Failed to fetch" };
    expect(await session().deleteAccount()).toBe(tr.account.deleteCloudFailed);
    cloud.rpcError = { message: "JWT expired" };
    expect(await session().deleteAccount()).toBe(tr.auth.errSessionExpired);
    expect(session().userId).toBe(A.id);
    expect(count("lists")).toBe(1);
    expect(sync.calls.at(-1), "and syncs again, the photos it took down sent back").toBe(`start:${A.id}`);
  });

  it("deletes nothing when the account's photos could not be taken down first", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    sync.purgeFails = true;
    expect(await session().deleteAccount()).toBe(tr.account.deleteCloudFailed);
    expect(cloud.calls).toEqual(["photos:purge"]);
    expect(session().userId).toBe(A.id);
    expect(count("lists")).toBe(1);
  });

  it("then empties the device and ends every session the account had", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    expect(await session().deleteAccount()).toBeNull();
    expect(sync.calls).toEqual([`start:${A.id}`, "stop"]);
    expect(cloud.calls).toEqual(["photos:purge", "rpc:delete_own_account", "signOut:global", "signOut:local"]);
    expect(session().userId).toBeNull();
    expect(count("lists")).toBe(0);
    for (const key of [OWNER, LAST_USER, LAST_EMAIL]) expect(device.stored.has(key)).toBe(false);
  });

  it("leaves a device it could not empty to be emptied by whoever signs in next", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    harness.db!.exec("CREATE TRIGGER stuck BEFORE DELETE ON lists BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END");
    expect(await session().deleteAccount()).toBe(tr.account.deleteWipeFailed);
    expect(session().userId).toBeNull();
    expect(count("lists")).toBe(1);
    harness.db!.exec("DROP TRIGGER stuck");
    // Nobody is left to send the deleted account's rows to, so they never block the next one.
    expect(await session().signIn(B.email, B.password)).toBeNull();
    expect(count("lists")).toBe(0);
    expect(device.stored.get(OWNER)).toBe(B.id);
  });
});

describe("checking the password again", () => {
  it("says a wrong password plainly, and pauses after a run of them", async () => {
    await session().signIn(A.email, A.password);
    for (let i = 0; i < VERIFY_MAX_FAILURES; i++) expect(await session().verifyPassword("yanlis")).toBe(tr.account.wrongPassword);
    expect(await session().verifyPassword(A.password)).toBe(tr.auth.errRateLimit);
    vi.useFakeTimers({ now: Date.now() + VERIFY_COOLDOWN_MS, toFake: ["Date"] });
    expect(await session().verifyPassword(A.password)).toBeNull();
    vi.useRealTimers();
  });

  it("finds the address when the app opened offline, and accepts the right password", async () => {
    await session().signIn(A.email, A.password);
    useSession.setState({ email: null });
    expect(await session().verifyPassword(A.password)).toBeNull();
    expect(session().email).toBe(A.email);
  });

  it("ends a session the check opened for another account, keeping the lists for this one", async () => {
    await session().signIn(A.email, A.password);
    await createList("Market");
    useSession.setState({ email: B.email });
    expect(await session().verifyPassword(B.password)).toBe(tr.auth.errSessionExpired);
    expect(cloud.calls).toEqual(["signOut:local"]);
    expect(session().userId).toBeNull();
    expect(device.stored.get(OWNER)).toBe(A.id);
    expect(await session().signIn(A.email, A.password)).toBeNull();
    expect(count("lists")).toBe(1);
  });

  it("changes the password with the current one, and the address trimmed", async () => {
    await session().signIn(A.email, A.password);
    expect(await session().changePassword(A.password, "kisa")).toBe(tr.auth.errWeakPassword);
    expect(await session().changePassword(A.password, "yeni-parola1")).toBeNull();
    expect(await session().changeEmail("  yeni@ev.com ")).toBeNull();
    expect(cloud.calls.slice(-2)).toEqual(["updateUser:current_password,password", "updateUser:email"]);
    cloud.updateError = { message: "New password should be different from the old password." };
    expect(await session().changePassword(A.password, A.password)).toBe(tr.auth.errSamePassword);
    cloud.updateError = { message: "Email rate limit exceeded" };
    expect(await session().changeEmail("yeni@ev.com")).toBe(tr.auth.errRateLimit);
  });

  it("asks for a new sign-in when no address is known anywhere", async () => {
    await session().signIn(A.email, A.password);
    useSession.setState({ email: null });
    cloud.session = null;
    device.stored.delete(LAST_EMAIL);
    expect(await session().verifyPassword(A.password)).toBe(tr.auth.errSessionExpired);
  });
});

describe("a forgotten password", () => {
  const link = `${HOSTED_RECOVERY_PAGE}#access_token=access&expires_in=3600&refresh_token=refresh&token_type=bearer&type=recovery`;

  it("sends the link to the hosted page, and says the same for an address with no account", async () => {
    expect(await session().requestPasswordReset("  a@ev.com ")).toBeNull();
    expect(cloud.calls).toEqual([`reset:a@ev.com:${HOSTED_RECOVERY_PAGE}`]);
    cloud.resetError = { message: "User not found" };
    expect(await session().requestPasswordReset("x@ev.com")).toBeNull();
    cloud.resetError = { message: "Email rate limit exceeded" };
    expect(await session().requestPasswordReset("a@ev.com")).toBe(tr.auth.errRateLimit);
  });

  it("sends a link back to the page it was asked from on the web", async () => {
    device.os = "web";
    vi.stubGlobal("location", { origin: "https://topraksv.github.io" });
    vi.stubEnv("EXPO_BASE_URL", "/gital");
    await session().requestPasswordReset("a@ev.com");
    expect(cloud.calls).toEqual([`reset:a@ev.com:${HOSTED_RECOVERY_PAGE}`]);
    expect(await session().preparePasswordRecovery(link)).toBe("ready");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sets the new password on the link's own session, which then ends", async () => {
    // A link that failed forgets any the page opened before it.
    expect(await session().preparePasswordRecovery("not a link")).toBe("invalid");
    expect(await session().completePasswordRecovery("yeni-parola1")).toBe(tr.auth.resetInvalidBody);
    expect(await session().preparePasswordRecovery(link)).toBe("ready");
    expect(await session().completePasswordRecovery("kisa")).toBe(tr.auth.errWeakPassword);
    // A refused save keeps the link's session, so the next press needs no new e-mail.
    cloud.updateError = { message: "New password should be different from the old password." };
    expect(await session().completePasswordRecovery("eski-parola1")).toBe(tr.auth.errSamePassword);
    cloud.updateError = null;
    expect(await session().completePasswordRecovery("yeni-parola1")).toBeNull();
    expect(cloud.calls).toEqual(["recovery:setSession:access", "recovery:updateUser", "recovery:updateUser", "recovery:signOut"]);
    // The device's own session was never touched, and the link is spent.
    expect(session().userId).toBeNull();
    expect(await session().completePasswordRecovery("yeni-parola1")).toBe(tr.auth.resetInvalidBody);
  });

  it("tells an expired link, a refused one and a dropped connection apart", async () => {
    expect(await session().preparePasswordRecovery(`${HOSTED_RECOVERY_PAGE}#error=access_denied&error_code=otp_expired`)).toBe("expired");
    expect(await session().preparePasswordRecovery("https://evil.example/reset-password")).toBe("invalid");
    cloud.setSessionError = { name: "AuthRetryableFetchError", message: "Failed to fetch" };
    expect(await session().preparePasswordRecovery(link)).toBe("offline");
    cloud.setSessionError = { name: "AuthApiError", message: "Invalid Refresh Token" };
    expect(await session().preparePasswordRecovery(link)).toBe("invalid");
  });
});
