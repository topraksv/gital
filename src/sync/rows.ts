/**
 * A row at the server boundary, both ways, checked against the columns
 * Drizzle declares rather than a second list of them: what the device sends
 * must be what its schema could have written, and what it takes must be what
 * its schema can hold. Helix's `outbound-validation.ts` and `toLocal`, with
 * its per-table checks left behind: Postgres bounds every value here.
 */

import { getTableColumns } from "drizzle-orm";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { isUuidShaped } from "./merge-policy";

/** Keyed by the person as well as the id on the server (`00000000000003_sync.sql`). */
export const PERSONAL_TABLES: ReadonlySet<SyncedTableName> = new Set(["products", "sets", "set_items", "pantry_items", "pantry_moves"]);

interface Column {
  kind: "text" | "integer" | "boolean";
  notNull: boolean;
  /** What a column missing from an older event is sent as, in the driver's shape. */
  fallback: unknown;
}

const COLUMNS = new Map<SyncedTableName, Map<string, Column>>(
  (Object.keys(SYNCED_TABLES) as SyncedTableName[]).map((table) => [
    table,
    new Map(
      Object.values(getTableColumns(SYNCED_TABLES[table])).map((column) => [
        column.name,
        {
          kind: column.columnType === "SQLiteBoolean" ? "boolean" : column.columnType === "SQLiteInteger" ? "integer" : "text",
          notNull: column.notNull,
          fallback: column.default == null ? null : column.mapToDriverValue(column.default),
        },
      ]),
    ),
  ]),
);

function fits(column: Column, value: unknown): boolean {
  if (value == null) return !column.notNull;
  if (column.kind === "text") return typeof value === "string";
  if (column.kind === "integer") return Number.isSafeInteger(value);
  return value === true || value === false || value === 0 || value === 1;
}

/**
 * An outbox payload as PostgREST takes it, or `null` for one the schema could
 * not have written. Every column is named: an event queued before a column
 * existed sends its default, which is what the migration gave the row.
 */
export function toServerRow(table: SyncedTableName, payload: Record<string, unknown>, userId: string): Record<string, unknown> | null {
  const columns = COLUMNS.get(table)!;
  if (Object.keys(payload).some((key) => !columns.has(key)) || !isUuidShaped(payload.id)) return null;
  const out: Record<string, unknown> = {};
  for (const [name, column] of columns) {
    const value = name in payload ? payload[name] : column.fallback;
    if (!fits(column, value)) return null;
    out[name] = column.kind === "boolean" && value != null ? Boolean(value) : value;
  }
  if (Number(out.tombstone_version) < 0) return null;
  if (PERSONAL_TABLES.has(table)) out.user_id = userId;
  return out;
}

/** Postgres answers `…00.123456+00:00`; the device writes and compares `…00.123Z`. */
function canonicalTimestamp(value: unknown): unknown {
  if (value == null) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error("invalid server timestamp");
  return new Date(parsed).toISOString();
}

/**
 * A pulled or acknowledged row in the shape SQLite stores, or a throw that
 * keeps the whole page from landing. A column the device does not have — the
 * list's owner, the person's id, one a newer server added — is dropped; the
 * id becomes the pull's keyset cursor, so its shape is checked.
 */
export function toLocalRow(table: SyncedTableName, raw: Record<string, unknown>, userId: string): Record<string, unknown> {
  if (PERSONAL_TABLES.has(table) && raw.user_id !== userId) throw new Error(`pull ${table}: another person's row`);
  if (!isUuidShaped(raw.id) || typeof raw.updated_at !== "string") throw new Error(`pull ${table}: invalid server row`);
  const out: Record<string, unknown> = {};
  for (const [name, column] of COLUMNS.get(table)!) {
    if (!(name in raw)) continue;
    // Every `_at` column is a timestamptz on the server.
    const value = name.endsWith("_at") ? canonicalTimestamp(raw[name]) : raw[name];
    if (!fits(column, value) || (column.kind === "boolean" && typeof value === "number")) throw new Error(`pull ${table}: invalid ${name}`);
    out[name] = typeof value === "boolean" ? Number(value) : value;
  }
  if (Number(out.tombstone_version) < 0) throw new Error(`pull ${table}: invalid tombstone_version`);
  return out;
}
