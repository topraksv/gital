/**
 * The write layer, Helix's (`src/db/mutations.ts`). Every write goes through
 * `writeRows`, which in one transaction upserts the row and queues its outbox
 * event, so the screen never waits on the network and sync never misses a
 * write. Deletes are tombstones, which is also what undo restores from.
 *
 * Where it departs: Helix stamps every row with the signed-in `user_id` and
 * refuses to overwrite another account's row. A Gital list is scoped by its
 * members instead, and there are no members until accounts exist, so that
 * check arrives with sharing as a role check (`docs/ARCHITECTURE.md`).
 */

import { getTableColumns } from "drizzle-orm";
import type { SQLiteBindValue } from "expo-sqlite";
import { getSqliteAsync, withTransaction } from "./client";
import { SYNCED_TABLES, type SyncedTableName } from "./schema";

export interface RowWrite {
  table: SyncedTableName;
  /** The whole row in Drizzle's camelCase shape, id included. */
  row: Record<string, unknown>;
}

/** A row as SQLite stores it, snake_case, taken before a delete so undo can restore it. */
export type RowSnapshot = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function toDbShape(table: SyncedTableName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(SYNCED_TABLES[table]))) {
    if (key in row) out[column.name] = row[key] ?? null;
  }
  return out;
}

/** snake_case stored row → camelCase write shape. */
export function fromDbShape(table: SyncedTableName, dbRow: object): Record<string, unknown> {
  // `object`, because a typed SELECT result is an interface and TypeScript
  // will not pass one as an index signature; the one narrowing lives here.
  const source = dbRow as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(SYNCED_TABLES[table]))) {
    if (column.name in source) out[key] = source[column.name];
  }
  return out;
}

/**
 * A delete moves the generation on by exactly one; an edit or an undo keeps
 * the highest generation already seen. Helix's `sync/tombstone-policy.ts`,
 * here until the sync layer exists to own it.
 */
function resolveTombstoneVersion(
  existing: { deletedAt: string | null; tombstoneVersion: number } | null,
  requestedDeletedAt: string | null,
  requestedVersion: number,
): number {
  if (!existing) return requestedDeletedAt ? Math.max(1, requestedVersion) : requestedVersion;
  const version = Math.max(existing.tombstoneVersion, requestedVersion);
  return requestedDeletedAt && existing.deletedAt == null ? version + 1 : version;
}

/** `created_at` is set once: an edit that re-supplied it would reset the row's age. */
const UPSERT_IMMUTABLE_COLUMNS = new Set(["id", "created_at"]);

function upsertSql(table: SyncedTableName, dbRow: Record<string, unknown>): { sql: string; args: SQLiteBindValue[] } {
  const keys = Object.keys(dbRow);
  const updates = keys
    .filter((key) => !UPSERT_IMMUTABLE_COLUMNS.has(key))
    .map((key) => `${key} = excluded.${key}`)
    .join(", ");
  return {
    sql: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    args: keys.map((key) => dbRow[key] as SQLiteBindValue),
  };
}

type ExistingRow = { deleted_at: string | null; tombstone_version: number };

/**
 * Upsert each row and queue its outbox event, all in one transaction.
 * `validate` runs first, inside the same transaction, so no other local write
 * can land between the check and the commit.
 */
export async function writeRows(writes: readonly RowWrite[], validate?: () => Promise<void>): Promise<void> {
  const sqlite = await getSqliteAsync();
  await withTransaction(async () => {
    await validate?.();
    for (const { table, row } of writes) {
      const id = row.id;
      if (typeof id !== "string" || id === "") throw new Error(`Write row id is invalid in ${table}`);
      const existing = await sqlite.getFirstAsync<ExistingRow>(
        `SELECT deleted_at, tombstone_version FROM ${table} WHERE id = ?`,
        [id],
      );
      const timestamp = nowIso();
      const deletedAt = "deletedAt" in row ? ((row.deletedAt as string | null | undefined) ?? null) : (existing?.deleted_at ?? null);
      const requestedVersion = Number.isSafeInteger(row.tombstoneVersion) && Number(row.tombstoneVersion) >= 0
        ? Number(row.tombstoneVersion)
        : 0;
      const dbRow = toDbShape(table, {
        ...row,
        createdAt: row.createdAt ?? timestamp,
        updatedAt: timestamp,
        deletedAt,
        tombstoneVersion: resolveTombstoneVersion(
          existing ? { deletedAt: existing.deleted_at, tombstoneVersion: existing.tombstone_version } : null,
          deletedAt,
          requestedVersion,
        ),
      });
      const { sql, args } = upsertSql(table, dbRow);
      await sqlite.runAsync(sql, args);
      // The same row written twice in one millisecond shares a key; the newer
      // payload replaces the older, or the stale one would be pushed and echoed
      // back over the edit. The table is in the key because the index is global.
      await sqlite.runAsync(
        `INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
         VALUES (?, ?, 'upsert', ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
        [table, id, JSON.stringify(dbRow), `${table}:${id}:${timestamp}`, timestamp],
      );
    }
  });
}

async function findLiveRow(table: SyncedTableName, id: string): Promise<RowSnapshot | null> {
  const sqlite = await getSqliteAsync();
  return sqlite.getFirstAsync<RowSnapshot>(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]);
}

/** The live row, or a refusal: a stale screen must not revive a row deleted under it. */
export async function readLiveRow(table: SyncedTableName, id: string): Promise<RowSnapshot> {
  const row = await findLiveRow(table, id);
  if (!row) throw new Error(`Cannot edit missing ${table} row`);
  return row;
}

/**
 * Tombstone a row. Returns what it was, for undo, or `null` when it was not there.
 *
 * The row is read outside the transaction, so it is checked again inside:
 * a write that landed in between would be reverted by this one, and undo would
 * restore the older copy. Helix's reads once; a rename and a delete queued
 * together are what that misses.
 */
export async function softDelete(table: SyncedTableName, id: string): Promise<RowSnapshot | null> {
  const previous = await findLiveRow(table, id);
  if (!previous) return null;
  await writeRows([{ table, row: { ...fromDbShape(table, previous), deletedAt: nowIso() } }], async () => {
    const current = await findLiveRow(table, id);
    if (!current || Object.keys(previous).some((column) => current[column] !== previous[column])) {
      throw new Error(`The ${table} row changed before its delete`);
    }
  });
  return previous;
}

/**
 * Undo a delete. Only a row that is still a tombstone may be restored: a
 * snapshot can outlive its screen, and restoring it over a row that came back
 * another way would overwrite the newer one.
 */
export async function restoreRow(table: SyncedTableName, snapshot: RowSnapshot): Promise<void> {
  const row: Record<string, unknown> = { ...fromDbShape(table, snapshot), deletedAt: null };
  const sqlite = await getSqliteAsync();
  await writeRows([{ table, row }], async () => {
    const current = await sqlite.getFirstAsync<ExistingRow>(`SELECT deleted_at FROM ${table} WHERE id = ?`, [String(row.id)]);
    if (current?.deleted_at == null) throw new Error(`Cannot restore ${table} row without its tombstone`);
  });
}
