/**
 * The outbox engine (SPEC 10.2), Helix's (`src/sync/engine.ts`): push, then
 * pull, one run at a time, last writer wins on the server's clock, a delete
 * generation over any clock. A failure is shown in the status store and
 * retried with backoff; a late answer from a session that has ended is
 * dropped by the epoch.
 *
 * Where it departs, each for a reason in `docs/ARCHITECTURE.md` (2026-09-27):
 * a personal row is keyed by its person on the server; a batch the server
 * refuses is sent row by row, so one bad row waits aside instead of stopping
 * every other; a row this device made afresh over a delete it never saw is
 * added again rather than lost; the pull reaches back a few seconds past its
 * cursor; photos travel beside the rows, before the row that names one; a
 * list shared with this person is fetched whole when they join it and
 * dropped from the device when they leave it (`docs/ARCHITECTURE.md`,
 * sharing); and Kiler is the household's while the person is in one, which
 * the probe names and the device follows (SPEC 12.13).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { getSqliteAsync, withTransaction } from "../db/client";
import { fromDbShape, nowIso, onLocalWrite, setActor, writeRows, type RowWrite } from "../db/mutations";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { HELD_PANTRY, heldPantry, settleArrivals } from "../data/pantry";
import { tr } from "../i18n/tr";
import { retryDeadLetter } from "./dead-letters";
import {
  classifyOutboxBatch,
  cursorIsAtServerHead,
  formatPullCursor,
  isAddedAgain,
  isUuidShaped,
  parsePullCursor,
  remoteWinsLww,
  shouldApplyServerAck,
  type OutboxEvent,
  type ParsedOutboxEvent,
  type PullCursor,
  type RejectedOutboxEvent,
} from "./merge-policy";
import { fetchMissingPhotos, sendPendingPhotos } from "./photos";
import { PERSONAL_TABLES, toLocalRow, toServerRow } from "./rows";
import { SessionEpoch, SessionEpochCancelledError, type SessionEpochToken } from "./session-epoch";
import { forgetOffers, listOffers, useOffers } from "./sharing";
import { classifyRefreshFailure, completedSyncState, isNetworkFailure, useSyncStatus, type RefreshOutcome } from "./status";
import { getSupabase } from "./supabase";

const TABLES = Object.keys(SYNCED_TABLES) as SyncedTableName[];
/**
 * Parents first (`SYNCED_TABLES`): the server checks an item's list.
 * Memberships last, since a device only ever narrows one: what was done just
 * before leaving a list, or a household, lands before the leaving does.
 */
const PUSHED = [...TABLES.filter((table) => table !== "list_members"), "list_members" as const];
/** Whose rows these are is the household's while the person is in one (SPEC 12.13). */
const PANTRY: ReadonlySet<SyncedTableName> = new Set(["pantry_items", "pantry_moves"]);
const PULL_PAGE = 1000;
const PUSH_BATCH = 200;
/** SQLite binds this many ids per statement comfortably on every build (Helix's). */
const ID_CHUNK = 200;
/**
 * How far before its cursor a table's pull starts. `updated_at` is when a
 * transaction began, not when it committed, so a row can become visible after
 * a later one has already moved the cursor past it; Helix, with one writer,
 * never met that. Re-reading five seconds costs a few rows the merge takes
 * again unchanged, and a late row is found at its table's next change.
 */
const PULL_OVERLAP_MS = 5000;

type Supabase = SupabaseClient;
type LocalDatabase = Awaited<ReturnType<typeof getSqliteAsync>>;

/** The session the client holds is not the account whose rows these are. */
class SessionMismatchError extends Error {}

const sessionEpoch = new SessionEpoch();
let rerunRequestedFor: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
/** The run under way; runs never overlap. */
let inFlight: Promise<boolean> | null = null;
/** Set when the server has no `sync_cursors()`, until the session ends. */
let changeProbeUnavailable = false;

const isAuthError = (raw: string) => /jwt|token|401|unauthorized|not authenticated|permission denied/i.test(raw);

function friendlySyncError(raw: string): string {
  return isNetworkFailure(raw) ? tr.sync.errNetwork : tr.sync.errGeneric;
}

/**
 * What the server will never take as sent: a value out of bounds (class 22),
 * a constraint or a generation it refuses (23), a row the caller may not
 * write. "Permission denied for table" is not here: that is a request with no
 * signed-in role, which a new session fixes.
 */
function isRefusal(error: { code?: string; message: string }): boolean {
  return /^2[23]/.test(error.code ?? "") || (error.code === "42501" && /row-level security/i.test(error.message));
}

/**
 * A delete taken back, or made twice, before any of it was sent leaves the row
 * generations ahead of the server, which takes one step at a time and only the
 * newest event is sent. Nobody else saw those steps, so the row goes again at
 * the generation the server holds, and its answer brings the device back to it.
 * Asked by what the server holds, not by the refusal's words: ahead is the only
 * way the trigger refuses a generation, and a message can be reworded.
 * Measured 2026-09-30: such rows waited aside for good, and Helix's engine
 * has the same hole.
 */
async function atServerGeneration(
  supabase: Supabase,
  table: SyncedTableName,
  row: Record<string, unknown>,
  token: SessionEpochToken,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from(table).select("tombstone_version").eq("id", String(row.id)).limit(1).abortSignal(token.signal);
  if (error) throw new Error(`push ${table}: ${error.message}`);
  const held = (data as { tombstone_version: number }[] | null)?.[0];
  return held && held.tombstone_version < Number(row.tombstone_version) ? { ...row, tombstone_version: held.tombstone_version } : null;
}

function* chunks<T>(values: readonly T[]): Generator<T[]> {
  for (let at = 0; at < values.length; at += ID_CHUNK) yield values.slice(at, at + ID_CHUNK);
}

function assertActive(token: SessionEpochToken): void {
  sessionEpoch.assertCurrent(token);
}

async function tryRefreshSession(supabase: Supabase): Promise<RefreshOutcome> {
  const { data, error } = await supabase.auth.refreshSession();
  return !error && data.session ? "refreshed" : classifyRefreshFailure(error);
}

/**
 * The client's session must be this account's before anything is sent: a
 * personal row is stamped with `userId`, and under another account's session
 * every one of them would be refused and set aside as if it were bad.
 */
async function assertSessionIs(supabase: Supabase, userId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== userId) throw new SessionMismatchError("session: not this account's");
}

/**
 * The server's copy, `created_at` included, unlike a local write's upsert: a
 * row added again carries a new one, and a device that kept the old would
 * push its next edit as if that too were made afresh (`isAddedAgain`).
 */
async function upsertLocal(sqlite: LocalDatabase, table: SyncedTableName, row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  await sqlite.runAsync(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
     ON CONFLICT(id) DO UPDATE SET ${keys.filter((key) => key !== "id").map((key) => `${key} = excluded.${key}`).join(", ")}`,
    keys.map((key) => row[key] as string | number | null),
  );
}

async function newestOutboxIds(sqlite: LocalDatabase, table: SyncedTableName, rowIds: readonly string[]): Promise<Map<string, number>> {
  const newest = new Map<string, number>();
  for (const chunk of chunks(rowIds)) {
    const rows = await sqlite.getAllAsync<{ row_id: string; id: number }>(
      `SELECT row_id, MAX(id) AS id FROM outbox WHERE table_name = ? AND row_id IN (${chunk.map(() => "?").join(", ")}) GROUP BY row_id`,
      [table, ...chunk],
    );
    for (const row of rows) newest.set(row.row_id, row.id);
  }
  return newest;
}

interface Acknowledged {
  event: ParsedOutboxEvent;
  answer: Record<string, unknown>;
}

function matchAnswers(table: SyncedTableName, events: readonly ParsedOutboxEvent[], data: unknown): Acknowledged[] {
  const answers = (data ?? []) as Record<string, unknown>[];
  if (answers.length !== events.length) throw new Error(`push ${table}: incomplete acknowledgement`);
  const byRow = new Map(events.map((event) => [event.row_id, event]));
  return answers.map((answer) => {
    const event = byRow.get(String(answer.id));
    if (!event) throw new Error(`push ${table}: unknown acknowledgement`);
    return { event, answer };
  });
}

/**
 * One statement for the batch, and the server takes it whole or not at all.
 * Refused, it is sent again row by row, so the rows it will take go and only
 * the one it will not waits aside.
 */
async function sendRows(
  supabase: Supabase,
  table: SyncedTableName,
  events: ParsedOutboxEvent[],
  rows: Record<string, unknown>[],
  token: SessionEpochToken,
): Promise<{ acknowledged: Acknowledged[]; refused: RejectedOutboxEvent[] }> {
  const onConflict = PERSONAL_TABLES.has(table) ? "user_id,id" : "id";
  const send = (batch: Record<string, unknown>[]) =>
    supabase.from(table).upsert(batch, { onConflict }).select("*").abortSignal(token.signal);
  const acknowledged: Acknowledged[] = [];
  const refused: RejectedOutboxEvent[] = [];
  if (rows.length === 0) return { acknowledged, refused };
  const { data, error } = await send(rows);
  if (!error) return { acknowledged: matchAnswers(table, events, data), refused };
  if (!isRefusal(error)) throw new Error(`push ${table}: ${error.message}`);
  for (const [at, row] of rows.entries()) {
    assertActive(token);
    let one = rows.length === 1 ? { data: null, error } : await send([row]);
    if (one.error?.code === "23514") {
      const level = await atServerGeneration(supabase, table, row, token);
      if (level) one = await send([level]);
    }
    if (!one.error) acknowledged.push(...matchAnswers(table, [events[at]!], one.data));
    else if (isRefusal(one.error)) refused.push({ ...events[at]!, reason: "refused" });
    else throw new Error(`push ${table}: ${one.error.message}`);
  }
  return { acknowledged, refused };
}

/** `owner` is whose a personal row is: the person, or for a pantry row the Kiler this device holds. */
async function pushTable(supabase: Supabase, table: SyncedTableName, owner: string, token: SessionEpochToken): Promise<void> {
  const sqlite = await getSqliteAsync();
  for (;;) {
    assertActive(token);
    const events = await sqlite.getAllAsync<OutboxEvent>(
      `SELECT id, payload, row_id FROM outbox WHERE table_name = ? ORDER BY id ASC LIMIT ${PUSH_BATCH}`,
      [table],
    );
    if (events.length === 0) return;
    const { latestByRow, rejected } = classifyOutboxBatch(events);
    const pushed: ParsedOutboxEvent[] = [];
    const rows: Record<string, unknown>[] = [];
    for (const event of latestByRow.values()) {
      const row = toServerRow(table, event.row, owner);
      if (row) {
        pushed.push(event);
        rows.push(row);
      } else {
        rejected.push({ ...event, reason: "invalid_row" });
      }
    }
    const { acknowledged, refused } = await sendRows(supabase, table, pushed, rows, token);
    rejected.push(...refused);
    // A sign-out or another account may have come while PostgREST was
    // answering: the outbox is never cleared for a session that has ended.
    assertActive(token);
    const addedAgain: RowWrite[] = [];
    await withTransaction(async () => {
      assertActive(token);
      const newest = await newestOutboxIds(sqlite, table, acknowledged.map(({ event }) => event.row_id));
      for (const { event, answer } of acknowledged) {
        if (!shouldApplyServerAck(event.id, newest.get(event.row_id) ?? null)) continue;
        const local = toLocalRow(table, answer, owner);
        if (isAddedAgain(event.row, local)) {
          addedAgain.push({ table, row: { ...fromDbShape(table, event.row), tombstoneVersion: local.tombstone_version } });
        } else {
          await upsertLocal(sqlite, table, local);
        }
      }
      // A clue is only as old as the row it names: once a newer version is taken, it is history.
      for (const chunk of chunks(acknowledged.map(({ event }) => event.row_id))) {
        await sqlite.runAsync(
          `DELETE FROM sync_dead_letters WHERE table_name = ? AND row_id IN (${chunk.map(() => "?").join(", ")})`,
          [table, ...chunk],
        );
      }
      for (const event of rejected) {
        await sqlite.runAsync(
          `INSERT OR IGNORE INTO sync_dead_letters (outbox_id, table_name, row_id, payload, reason, quarantined_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [event.id, table, event.row_id, event.payload, event.reason, nowIso()],
        );
      }
      await sqlite.runAsync(`DELETE FROM outbox WHERE id IN (${events.map(() => "?").join(", ")})`, events.map((event) => event.id));
    });
    // At the generation the server holds, so the next pass of this loop sends it and it lands.
    if (addedAgain.length > 0) await writeRows(addedAgain);
  }
}

async function pushOutbox(supabase: Supabase, userId: string, token: SessionEpochToken): Promise<void> {
  // Before the rows: a row naming a photo must never reach a device before the photo can.
  await sendPendingPhotos(supabase, token.signal);
  const pantry = (await heldPantry(userId)).id;
  for (const table of PUSHED) await pushTable(supabase, table, PANTRY.has(table) ? pantry : userId, token);
}

interface ServerHead {
  table_name: string;
  max_updated_at: string | null;
  max_id: string | null;
}

/**
 * Each table's keyset head in one request, which Kiler the server shows this
 * person (`pantry_home`, migration 12), and a hash of the offers waiting on
 * them (`offers`, migration 13; `undefined` from a server before it); `null`
 * pulls every table. A table the answer leaves out is pulled too: the
 * function's list is a second copy of `SYNCED_TABLES`, and a copy can fall behind.
 */
async function fetchServerHeads(
  supabase: Supabase,
  token: SessionEpochToken,
): Promise<{ heads: Map<string, PullCursor | null>; home: string | null; offers: string | null | undefined } | null> {
  if (changeProbeUnavailable) return null;
  const { data, error } = await supabase.rpc("sync_cursors").abortSignal(token.signal);
  if (error) {
    if (error.code !== "PGRST202") throw new Error(`pull probe: ${error.message}`);
    changeProbeUnavailable = true;
    return null;
  }
  const heads = new Map<string, PullCursor | null>();
  let home: string | null = null;
  let offers: string | null | undefined;
  for (const row of (data ?? []) as ServerHead[]) {
    if (row.table_name === "pantry_home") home = isUuidShaped(row.max_id) ? row.max_id : null;
    else if (row.table_name === "offers") offers = isUuidShaped(row.max_id) ? row.max_id : null;
    else if (row.max_updated_at == null && row.max_id == null) heads.set(row.table_name, null);
    else if (typeof row.max_updated_at === "string" && isUuidShaped(row.max_id)) heads.set(row.table_name, { ts: row.max_updated_at, id: row.max_id });
  }
  return { heads, home, offers };
}

/**
 * The offers waiting on this person (SPEC 1.4), asked for only when the
 * probe's hash of them moves. One that does not arrive keeps the old hash,
 * and the next sync asks again; the sync itself goes on, as it owes nothing to them.
 */
async function followOffers(hash: string | null | undefined, userId: string, token: SessionEpochToken): Promise<void> {
  if (hash === undefined || hash === useOffers.getState().seen) return;
  const answer = hash === null ? { offers: [] } : await listOffers(token.signal);
  assertActive(token);
  if ("refused" in answer) return;
  useOffers.setState({ seen: hash, received: answer.offers.filter((offer) => offer.to === userId) });
}

/**
 * Joining a household, leaving one or being removed (SPEC 12.13) changes the
 * Kiler the server shows this person, and the probe says which. The device
 * lets the one it held go — its rows, and what waited to go into it, which
 * the server now refuses — and pulls the new one from the start. Stamping a
 * stale write into the new Kiler instead would merge two homes by name.
 */
async function switchPantry(sqlite: LocalDatabase, from: string, to: string, userId: string, token: SessionEpochToken): Promise<void> {
  await withTransaction(async () => {
    assertActive(token);
    for (const table of PANTRY) {
      // A bare DELETE empties the table without the update hook, so Kiler's
      // live query would never hear its rows went (measured, SQLite 3.54).
      await sqlite.runAsync(`DELETE FROM ${table} WHERE true`);
      for (const queue of ["outbox", "sync_dead_letters"]) await sqlite.runAsync(`DELETE FROM ${queue} WHERE table_name = ?`, [table]);
    }
    await sqlite.runAsync("DELETE FROM sync_state WHERE table_name IN (?, ?) OR table_name LIKE ?", [...PANTRY, `${HELD_PANTRY}%`]);
    await sqlite.runAsync("INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)", [HELD_PANTRY + to, nowIso()]);
    // A household its owner deleted leaves no membership behind to say so.
    if (from !== userId) await dropList(sqlite, from);
  });
}

async function localMergeState(
  sqlite: LocalDatabase,
  table: SyncedTableName,
  ids: readonly string[],
): Promise<Map<string, { updated_at: string; tombstone_version: number }>> {
  const state = new Map<string, { updated_at: string; tombstone_version: number }>();
  for (const chunk of chunks(ids)) {
    const rows = await sqlite.getAllAsync<{ id: string; updated_at: string; tombstone_version: number }>(
      `SELECT id, updated_at, tombstone_version FROM ${table} WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
    for (const row of rows) state.set(row.id, row);
  }
  return state;
}

/** One table from `from` on, or with `list` one list's rows from the beginning, which moves no cursor. `owner` is `pushTable`'s. */
function fetchPage(supabase: Supabase, table: SyncedTableName, cursor: PullCursor, first: boolean, token: SessionEpochToken, list?: string) {
  let query = supabase.from(table).select("*").order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(PULL_PAGE);
  if (list) query = query.eq(table === "lists" ? "id" : "list_id", list);
  const page = first
    ? query.gte("updated_at", new Date(Date.parse(cursor.ts) - PULL_OVERLAP_MS).toISOString())
    : query.or(`updated_at.gt.${cursor.ts},and(updated_at.eq.${cursor.ts},id.gt.${cursor.id})`);
  return Promise.resolve(page.abortSignal(token.signal));
}

type Page = ReturnType<typeof fetchPage>;

/**
 * Every table's first page asked for at once; only the merge stays in order,
 * so a pull cut short still never leaves a child ahead of its list. One after
 * another, a first pull was a round trip per table before anything showed. A
 * page never merged — the pull stopped at an earlier table — is dropped; it
 * cannot reject unobserved, since PostgREST without `throwOnError` answers a
 * failed or aborted fetch with `{ error }`.
 */
function prefetch(tables: readonly SyncedTableName[], cursorFor: (table: SyncedTableName) => PullCursor, supabase: Supabase, token: SessionEpochToken, list?: string): Map<SyncedTableName, Page> {
  return new Map(tables.map((table) => [table, fetchPage(supabase, table, cursorFor(table), true, token, list)] as const));
}

async function pullTable(supabase: Supabase, table: SyncedTableName, from: PullCursor, owner: string, token: SessionEpochToken, firstPage: Page, list?: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  let cursor = from;
  let next = firstPage;
  for (;;) {
    assertActive(token);
    const { data, error } = await next;
    if (error) throw new Error(`pull ${table}: ${error.message}`);
    if (!data || data.length === 0) return;
    assertActive(token);
    // The whole page is checked before any of it lands or the cursor moves:
    // a bad row retries in place rather than hiding behind a newer cursor.
    const remotes = (data as Record<string, unknown>[]).map((raw) => toLocalRow(table, raw, owner));
    await withTransaction(async () => {
      const ids = remotes.map((remote) => String(remote.id));
      const local = await localMergeState(sqlite, table, ids);
      // A row with an edit still to send keeps it: the push that follows
      // decides, and taking the server's copy meanwhile would show the older
      // value until then — for ever, if that push is refused.
      const unsent = await newestOutboxIds(sqlite, table, ids);
      for (const remote of remotes) {
        assertActive(token);
        const held = local.get(String(remote.id));
        if (unsent.has(String(remote.id))) continue;
        if (remoteWinsLww(held?.updated_at ?? null, String(remote.updated_at), held?.tombstone_version ?? 0, Number(remote.tombstone_version))) {
          await upsertLocal(sqlite, table, remote);
        }
      }
      const last = remotes.at(-1)!;
      cursor = { ts: String(last.updated_at), id: String(last.id) };
      if (list) return;
      await sqlite.runAsync(
        `INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?) ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
        [table, formatPullCursor(cursor)],
      );
    });
    if (data.length < PULL_PAGE) return;
    next = fetchPage(supabase, table, cursor, false, token, list);
  }
}

async function pullAll(supabase: Supabase, userId: string, token: SessionEpochToken): Promise<void> {
  const sqlite = await getSqliteAsync();
  assertActive(token);
  // Asked even by a device that has never pulled: it says which Kiler to pull.
  const probe = await fetchServerHeads(supabase, token);
  let pantry = (await heldPantry(userId)).id;
  if (probe?.home && probe.home !== pantry) {
    await switchPantry(sqlite, pantry, probe.home, userId, token);
    pantry = probe.home;
  }
  await followOffers(probe?.offers, userId, token);
  const stored = await sqlite.getAllAsync<{ table_name: string; last_pulled_at: string }>("SELECT table_name, last_pulled_at FROM sync_state");
  const cursors = new Map(stored.map((row) => [row.table_name, parsePullCursor(row.last_pulled_at)]));
  const cursorFor = (table: SyncedTableName) => cursors.get(table) ?? parsePullCursor(null);
  // Merged parents first, so a pull cut short never leaves a child ahead of its list.
  const pending = TABLES.filter((table) => !(probe?.heads.has(table) && cursorIsAtServerHead(cursorFor(table), probe.heads.get(table) ?? null)));
  const pages = prefetch(pending, cursorFor, supabase, token);
  for (const table of pending) {
    await pullTable(supabase, table, cursorFor(table), PANTRY.has(table) ? pantry : userId, token, pages.get(table)!);
  }
}

/** The tables a list's membership opens, with the column that names the list. */
const LIST_SCOPED: readonly (readonly [SyncedTableName, string])[] = [
  ["lists", "id"],
  ["list_members", "list_id"],
  ["shops", "list_id"],
  ["items", "list_id"],
  ["wishes", "list_id"],
  ["wish_links", "list_id"],
];
const FETCHED = "list:";
const FROM_START = parsePullCursor(null);

/**
 * Joining and leaving (SPEC 1.2). A list shared with this person has rows
 * older than every cursor here, so a membership seen for the first time
 * fetches its list whole, once per device. A membership ended — left, or
 * removed by the owner — drops the list from the device, with whatever was
 * still to send for it, since the server will take none of it.
 */
async function followMemberships(supabase: Supabase, userId: string, token: SessionEpochToken): Promise<void> {
  const sqlite = await getSqliteAsync();
  const mine = await sqlite.getAllAsync<{ list_id: string; deleted_at: string | null }>(
    "SELECT list_id, deleted_at FROM list_members WHERE user_id = ? AND role <> 'owner'",
    [userId],
  );
  const fetched = new Set(
    (await sqlite.getAllAsync<{ table_name: string }>("SELECT table_name FROM sync_state WHERE table_name LIKE ?", [`${FETCHED}%`])).map((row) => row.table_name),
  );
  for (const { list_id: list, deleted_at: left } of mine) {
    assertActive(token);
    if (left) {
      await forgetList(sqlite, list);
    } else if (!fetched.has(FETCHED + list)) {
      const tables = LIST_SCOPED.map(([table]) => table);
      const pages = prefetch(tables, () => FROM_START, supabase, token, list);
      for (const table of tables) await pullTable(supabase, table, FROM_START, userId, token, pages.get(table)!, list);
      await sqlite.runAsync("INSERT OR REPLACE INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)", [FETCHED + list, nowIso()]);
    }
  }
}

function forgetList(sqlite: LocalDatabase, list: string): Promise<void> {
  return withTransaction(() => dropList(sqlite, list));
}

/** `forgetList` inside a transaction already open. */
async function dropList(sqlite: LocalDatabase, list: string): Promise<void> {
  for (const [table, column] of LIST_SCOPED) {
    await sqlite.runAsync(`DELETE FROM ${table} WHERE ${column} = ?`, [list]);
    for (const queue of ["outbox", "sync_dead_letters"]) {
      await sqlite.runAsync(`DELETE FROM ${queue} WHERE table_name = ? AND json_extract(payload, '$.${column}') = ?`, [table, list]);
    }
  }
  await sqlite.runAsync("DELETE FROM sync_state WHERE table_name = ?", [FETCHED + list]);
}

const RETRIED = "retried:";

/**
 * A refusal is final only for the engine that met it: 1.4.0 sends at the
 * server's generation the rows 1.3 set aside, and those waited on the owner's
 * phone until a sign-out wiped them (measured 2026-09-30). A new version sends
 * what waits aside once more, before its first push; a row it refuses too
 * waits until the next version, not the next sync.
 */
async function retryAsideAfterUpdate(): Promise<void> {
  const sqlite = await getSqliteAsync();
  const key = RETRIED + (Constants.expoConfig?.version ?? "");
  if (await sqlite.getFirstAsync("SELECT 1 FROM sync_state WHERE table_name = ?", [key])) return;
  for (const { id } of await sqlite.getAllAsync<{ id: number }>("SELECT id FROM sync_dead_letters")) await retryDeadLetter(id);
  await sqlite.runAsync("DELETE FROM sync_state WHERE table_name LIKE ?", [`${RETRIED}%`]);
  await sqlite.runAsync("INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)", [key, nowIso()]);
}

async function deadLetterCount(): Promise<number> {
  const sqlite = await getSqliteAsync();
  return (await sqlite.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sync_dead_letters"))!.n;
}

function clearScheduledSync(): void {
  clearTimeout(debounceTimer);
  clearTimeout(retryTimer);
  retryAttempt = 0;
  rerunRequestedFor = null;
}

async function runSync(userId: string, token: SessionEpochToken, allowRefresh: boolean): Promise<boolean> {
  const status = useSyncStatus.getState();
  const supabase = getSupabase();
  // Only a signed-in account starts a session, and only a configured build signs in.
  if (!supabase) return true;
  status.set({ state: "syncing" });
  try {
    await assertSessionIs(supabase, userId);
    await retryAsideAfterUpdate();
    await pushOutbox(supabase, userId, token);
    await pullAll(supabase, userId, token);
    await followMemberships(supabase, userId, token);
    assertActive(token);
    await settleArrivals(userId);
    await fetchMissingPhotos(supabase, token.signal);
    assertActive(token);
    const state = completedSyncState(await deadLetterCount());
    retryAttempt = 0;
    status.set({ state, lastSyncAt: nowIso(), error: null });
    return true;
  } catch (error) {
    if (error instanceof SessionEpochCancelledError || !sessionEpoch.isCurrent(token)) return false;
    if (error instanceof SessionMismatchError) {
      // A retry would meet the same session; a sign-in is what changes it.
      status.set({ state: "error", error: tr.sync.errReauth });
      return false;
    }
    const raw = String(error);
    let message = friendlySyncError(raw);
    if (isAuthError(raw)) {
      // Once, then a sign-in: a token refused straight after renewing will be refused again.
      const outcome = allowRefresh ? await tryRefreshSession(supabase).catch(classifyRefreshFailure) : "expired";
      if (!sessionEpoch.isCurrent(token)) return false;
      if (outcome === "refreshed") {
        status.set({ state: "syncing" });
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void syncNow(userId, false), 0);
        return false;
      }
      if (outcome === "expired") {
        // Retrying cannot bring back a refresh token that is gone; a sign-in can.
        status.set({ state: "error", error: tr.sync.errReauth });
        return false;
      }
      message = tr.sync.errNetwork;
    }
    status.set({ state: "error", error: message });
    // 5 s, 10 s, 20 s… at most five minutes.
    const delay = Math.min(5000 * 2 ** retryAttempt, 300_000);
    retryAttempt += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void syncNow(userId), delay);
    return false;
  }
}

/** Open sync for the signed-in account; only `src/auth/session.ts` calls it. */
export function startSyncSession(userId: string): void {
  sessionEpoch.start(userId);
  setActor(userId);
  changeProbeUnavailable = false;
  clearScheduledSync();
}

/** End the session's sync and wait until its run has let go of the database. */
export async function stopSyncSession(): Promise<void> {
  sessionEpoch.stop();
  setActor(null);
  forgetOffers();
  clearScheduledSync();
  await Promise.allSettled([inFlight]);
}

/**
 * Push the outbox and nothing else, for a sign-out: it decides whether
 * anything would be lost, and a pull would fetch pages into a database about
 * to be emptied. A failure leaves the rows in the outbox, which the caller counts.
 */
export async function flushOutbox(userId: string): Promise<void> {
  const token = sessionEpoch.capture(userId);
  const supabase = getSupabase();
  if (!token || !supabase) return;
  try {
    await assertSessionIs(supabase, userId);
    await pushOutbox(supabase, userId, token);
  } catch {
    // Counted by the caller.
  }
}

export async function syncNow(userId: string, allowRefresh = true): Promise<boolean> {
  const token = sessionEpoch.capture(userId);
  // A late timer from an account that has signed out must do nothing.
  if (!token) return false;
  if (inFlight) {
    // A write landed while a run was in flight: one more pass after it.
    rerunRequestedFor = userId;
    return inFlight;
  }
  inFlight = runSync(userId, token, allowRefresh);
  try {
    return await inFlight;
  } finally {
    // Released whatever happened: a run left holding it would stop sync for good.
    inFlight = null;
    const requested = rerunRequestedFor;
    rerunRequestedFor = null;
    if (requested) scheduleSync(requested, 250);
  }
}

/** A sync soon after a write; the screen never waits on it. */
export function scheduleSync(userId: string, delayMs = 1500): void {
  if (!sessionEpoch.capture(userId)) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(userId), delayMs);
}

onLocalWrite(() => {
  const userId = sessionEpoch.activeUserId;
  if (userId) scheduleSync(userId);
});
