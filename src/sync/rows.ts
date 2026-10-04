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

/**
 * Keyed by an owner as well as the id on the server (`00000000000003_sync.sql`):
 * the person, or for a pantry row the Kiler it is in (migration 12).
 */
export const PERSONAL_TABLES: ReadonlySet<SyncedTableName> = new Set(["products", "sets", "set_items", "pantry_items", "pantry_moves", "settings"]);

/**
 * The columns a row's server key is made of. A shop's or item's id is a hash
 * of its list's id, so anyone who knows the list could mint it elsewhere;
 * keyed by the list too (migration 14), that copy is another row.
 */
export function keyColumns(table: SyncedTableName): readonly string[] {
  if (PERSONAL_TABLES.has(table)) return ["user_id", "id"];
  return table === "shops" || table === "items" ? ["list_id", "id"] : ["id"];
}

interface Column {
  kind: "text" | "integer" | "boolean";
  notNull: boolean;
  /** Whether the schema gives a column a value when an insert names none. */
  defaulted: boolean;
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
          defaulted: column.default != null,
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
 * not have written. A column an event queued before it existed does not carry
 * is left out, never sent as its default: the server keeps what it holds,
 * which may be what another device wrote since (a photo, a receipt), and a new
 * row takes the server's default. Every column the server has no default for
 * was there from the table's first migration, so every event carries it.
 */
export function toServerRow(table: SyncedTableName, payload: Record<string, unknown>, owner: string): Record<string, unknown> | null {
  const columns = COLUMNS.get(table)!;
  if (Object.keys(payload).some((key) => !columns.has(key)) || !isUuidShaped(payload.id)) return null;
  const out: Record<string, unknown> = {};
  for (const [name, column] of columns) {
    if (!(name in payload)) {
      if (column.notNull && !column.defaulted) return null;
      continue;
    }
    const value = payload[name];
    if (!fits(column, value)) return null;
    out[name] = column.kind === "boolean" && value != null ? Boolean(value) : value;
  }
  if (Number(out.tombstone_version) < 0) return null;
  if (PERSONAL_TABLES.has(table)) out.user_id = owner;
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
export function toLocalRow(table: SyncedTableName, raw: Record<string, unknown>, owner: string): Record<string, unknown> {
  if (PERSONAL_TABLES.has(table) && raw.user_id !== owner) throw new Error(`pull ${table}: another owner's row`);
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
