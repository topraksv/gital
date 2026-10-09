/**
 * The one way into the database: expo-sqlite's asynchronous API on every
 * platform, with Drizzle over it through the generic sqlite-proxy driver.
 * Ported from Helix's `src/db/client.ts`; `docs/ARCHITECTURE.md` "Local storage
 * is Helix's" says why the synchronous web bridge is ruled out.
 */

import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteBindParams, type SQLiteDatabase } from "expo-sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { Platform } from "react-native";
import { kv } from "../services/kv";

const DB_NAME = "gital.db";
/** Set when a corrupt copy was replaced, until the person has been told. */
const REBUILT_KEY = "gital.database-rebuilt";

let handle: Promise<SQLiteDatabase> | null = null;

async function open(): Promise<SQLiteDatabase> {
  // The change listener is what re-runs a screen's query after a write.
  const db = await openDatabaseAsync(DB_NAME, { enableChangeListener: true });
  try {
    // WAL needs shared-memory VFS hooks that wa-sqlite's OPFS backend lacks.
    if (Platform.OS !== "web") await db.execAsync("PRAGMA journal_mode = WAL;");
    await db.execAsync("PRAGMA foreign_keys = ON;");
    return db;
  } catch (error) {
    // Left open, the connection keeps the file — on the web, OPFS's exclusive
    // handle — and every retry after it meets the lock. Helix drops it open.
    await db.closeAsync().catch(() => {});
    throw error;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isCorrupt(error: unknown): boolean {
  const code = typeof error === "object" && error != null && "code" in error ? String(error.code) : "";
  const details = `${code} ${error instanceof Error ? error.message : String(error)}`.toLowerCase();
  return ["sqlite_corrupt", "not a database", "database disk image is malformed"].some((signal) => details.includes(signal));
}

/**
 * A corrupt copy is deleted and opened afresh, and the next pull brings the
 * account's rows back. Helix renames it aside instead, because a Helix ledger
 * may live on one device only; every Gital row but the unsent ones is in the
 * account, and a file kept in an app's sandbox is one nobody here would
 * recover by hand. What may be lost is said once (`takeDatabaseRebuilt`).
 */
async function rebuild(): Promise<void> {
  await deleteDatabaseAsync(DB_NAME);
  await kv.set(REBUILT_KEY, "1").catch(() => {});
}

/**
 * On the web the previous page's worker can still hold OPFS's exclusive access
 * handle for a moment after a refresh. Helix measured that as an intermittent
 * "Tekrar dene" screen a plain reload could not clear, so opening backs off and
 * tries again, about two seconds in all, before it reports a failure. A
 * corrupt file is rebuilt once and opened again at once.
 */
async function openWithRetry(): Promise<SQLiteDatabase> {
  const attempts = 6;
  let lastError: unknown;
  let rebuilt = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await open();
    } catch (error) {
      lastError = error;
      if (isCorrupt(error) && !rebuilt) {
        rebuilt = true;
        await rebuild();
        continue;
      }
      if (attempt < attempts - 1) await delay(150 * (attempt + 1));
    }
  }
  throw lastError;
}

/** Whether a corrupt copy was replaced and the person not yet told; reading it is the telling. */
export async function takeDatabaseRebuilt(): Promise<boolean> {
  const rebuilt = (await kv.get(REBUILT_KEY).catch(() => null)) != null;
  if (rebuilt) await kv.remove(REBUILT_KEY).catch(() => {});
  return rebuilt;
}

export function getSqliteAsync(): Promise<SQLiteDatabase> {
  if (!handle) {
    handle = openWithRetry();
    // A failure is not cached: the boot screen's retry opens afresh.
    handle.catch(() => {
      handle = null;
    });
  }
  return handle;
}

// Release OPFS's access handle as the page goes, so a refresh can take it at
// once instead of racing a worker that is still closing. Best effort: the page
// is unloading and nothing can wait for it.
if (Platform.OS === "web" && typeof window !== "undefined") {
  const closeDb = () => {
    const current = handle;
    handle = null;
    void current?.then((db) => db.closeAsync()).catch(() => {});
  };
  window.addEventListener("pagehide", closeDb);
  window.addEventListener("beforeunload", closeDb);
}

/**
 * Every transaction goes through this one queue. The async driver shares a
 * single connection, and two overlapping `withTransactionAsync` calls issue a
 * nested BEGIN, which wedged Helix's worker into a white screen. No task opens
 * another transaction, so the queue cannot deadlock.
 */
let txChain: Promise<void> = Promise.resolve();
export async function withTransaction(task: () => Promise<void>): Promise<void> {
  const previous = txChain;
  let release!: () => void;
  txChain = new Promise<void>((resolve) => (release = resolve));
  try {
    await previous;
    const db = await getSqliteAsync();
    await db.withTransactionAsync(task);
  } finally {
    release();
  }
}

/** sqlite-proxy expects raw value arrays, which expo-sqlite hands back directly. */
async function exec(sql: string, params: unknown[], method: "run" | "all" | "get" | "values"): Promise<{ rows: unknown[] }> {
  const db = await getSqliteAsync();
  if (method === "run") {
    await db.runAsync(sql, params as SQLiteBindParams);
    return { rows: [] };
  }
  const statement = await db.prepareAsync(sql);
  try {
    const result = await statement.executeForRawResultAsync(params as SQLiteBindParams);
    const rows = await result.getAllAsync();
    return { rows: method === "get" ? (rows[0] ?? []) : rows };
  } finally {
    await statement.finalizeAsync();
  }
}

const database = drizzle(exec);

export function getDb() {
  return database;
}
