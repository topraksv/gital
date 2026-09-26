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
  /** A name from `LIST_COLORS` and `LIST_ICONS`; none draws the default (SPEC 1.8). */
  color: text("color"),
  icon: text("icon"),
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
    note: text("note"),
    urgent: integer("urgent", { mode: "boolean" }).notNull().default(false),
    /** Looked for and not in the shop (SPEC 3.7); a tick clears it. */
    notFound: integer("not_found", { mode: "boolean" }).notNull().default(false),
    /** What was bought in its place; taking the tick back clears it. */
    boughtInstead: text("bought_instead"),
    /** What was paid for it, in kuruş (SPEC 3.8); a price is a tick, and taking the tick back clears it. */
    priceMinor: integer("price_minor"),
    /** Set on the copy a finished shop keeps of what it bought; `null` on the list. */
    shopId: text("shop_id"),
  },
  // The list's open items are `shop_id IS NULL`, and history grows under them.
  (t) => [index("idx_items_list_id_shop_id").on(t.listId, t.shopId), index("idx_items_shop_id").on(t.shopId)],
);

/**
 * A finished shop (SPEC 3.4). Its id comes from the list and `number`, so two
 * members finishing at once write one shop; `finished_at` is its own column
 * because an undone shop finished again keeps its first `created_at`.
 */
export const shops = sqliteTable(
  "shops",
  {
    ...syncColumns,
    listId: text("list_id").notNull(),
    number: integer("number").notNull(),
    finishedAt: text("finished_at").notNull(),
  },
  (t) => [index("idx_shops_list_id").on(t.listId)],
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

export const SYNCED_TABLES = { lists, items, shops } as const;

export type SyncedTableName = keyof typeof SYNCED_TABLES;
