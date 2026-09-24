/**
 * The local SQLite schema, in Helix's conventions (`~/helix/src/db/schema.ts`):
 * ids are uuidv7 strings minted on the device, timestamps are ISO-8601 UTC
 * strings, and a row is only ever deleted by stamping `deleted_at`, because
 * sync needs the tombstone and undo restores from it.
 *
 * `docs/ARCHITECTURE.md` "Tables" is the model this grows towards. A column
 * lands with the slice that first writes it, so a table here can be narrower
 * than its row there.
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { UNITS } from "../domain/items";

/**
 * Helix's sync columns without its `user_id`: a Gital row is scoped by its list
 * or by its person, never both, so the scope column belongs to each table.
 */
const syncColumns = {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  /** Monotonic delete generation: a device that last saw generation N cannot
   *  revive a row deleted at N+1, whatever its clock says. */
  tombstoneVersion: integer("tombstone_version").notNull().default(0),
};

export const lists = sqliteTable("lists", {
  ...syncColumns,
  name: text("name").notNull(),
});

/**
 * A thing to buy on one list. Its id comes from the list and the folded name
 * (`src/db/ids.ts`), so the same product added twice is one row (SPEC 2.5).
 */
export const items = sqliteTable(
  "items",
  {
    ...syncColumns,
    listId: text("list_id").notNull(),
    name: text("name").notNull(),
    quantityMilli: integer("quantity_milli"),
    unit: text("unit", { enum: UNITS }),
    /** Helix's order column. A new item takes the lowest, so it lands on top. */
    sortOrder: integer("sort_order").notNull().default(0),
    checkedAt: text("checked_at"),
  },
  (t) => [index("idx_items_list_id").on(t.listId)],
);

/** Local only: every write waiting to be pushed. Never synced itself. */
export const outbox = sqliteTable(
  "outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    op: text("op", { enum: ["upsert"] }).notNull().default("upsert"),
    payload: text("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_outbox_table_id").on(t.tableName, t.id),
    index("idx_outbox_table_row_id_id").on(t.tableName, t.rowId, t.id),
  ],
);

export const SYNCED_TABLES = { lists, items } as const;

export type SyncedTableName = keyof typeof SYNCED_TABLES;
