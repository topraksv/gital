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
import { AISLES } from "../domain/catalogue";
import { UNITS } from "../domain/items";

/**
 * A list to shop from, or a wish collection (SPEC 7.4), which the wish list
 * keeps apart. A household (SPEC 12.13) is a `pantry` list only the server
 * makes, whose id is its owner's: it holds the members, and no screen lists it.
 */
export const LIST_KINDS = ["shop", "wish", "pantry"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

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
  kind: text("kind", { enum: LIST_KINDS }).notNull().default("shop"),
  /** "Alınanlar kilere gitsin" (SPEC 12.5): whether a finished shop fills the pantry. */
  pantry: integer("pantry", { mode: "boolean" }).notNull().default(true),
});

export const MEMBER_ROLES = ["owner", "editor", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Who is in a shared list (SPEC 1.2, 1.4, 1.9). Only the server makes a row —
 * an invitation accepted, or the owner's own when they first invite — so its
 * id is the server's. The device writes back only its person's `seen_at` and,
 * for the owner, another member's role or removal.
 */
export const listMembers = sqliteTable(
  "list_members",
  {
    ...syncColumns,
    listId: text("list_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: MEMBER_ROLES }).notNull(),
    /** What the others see, and the initials a row shows (SPEC 1.5). */
    name: text("name").notNull().default(""),
    /** When this member last opened the list; what arrived after it is new to them (SPEC 1.9). */
    seenAt: text("seen_at"),
  },
  (t) => [index("idx_list_members_list_id").on(t.listId)],
);

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
    /** A photo taken of it (SPEC 8.2), in `photos`. */
    photoId: text("photo_id"),
    /** Who put it on the list, and who ticked it (SPEC 1.5); the write layer stamps both. */
    addedBy: text("added_by"),
    checkedBy: text("checked_by"),
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
    /** The receipt's total in kuruş, typed over the sum of its prices; `null` is that sum (SPEC 3.8). */
    totalMinor: integer("total_minor"),
    /** The receipt's photo (the owner asked 2026-09-27), in `photos`. */
    photoId: text("photo_id"),
    /** Set with the tombstone when a history reset took it, which is no undo: a Kiler keeps what it brought. */
    clearedAt: text("cleared_at"),
  },
  (t) => [index("idx_shops_list_id").on(t.listId)],
);

/** A wish in a collection (SPEC 7.1, 7.3); its id is a uuidv7, since two wishes may share a name. */
export const wishes = sqliteTable(
  "wishes",
  {
    ...syncColumns,
    listId: text("list_id").notNull(),
    name: text("name").notNull(),
    note: text("note"),
    /** 0 low, 1 normal, 2 high (`PRIORITIES`). */
    priority: integer("priority").notNull().default(1),
    estimateMinor: integer("estimate_minor"),
    boughtAt: text("bought_at"),
    /** A photo of it seen in a shop (SPEC 7.1, 8.2), in `photos`. */
    photoId: text("photo_id"),
    /** "Şu tarihe kadar" (SPEC 7.1): a calendar day it is wanted by, which a reminder says (12.1). */
    dueOn: text("due_on"),
  },
  (t) => [index("idx_wishes_list_id").on(t.listId)],
);

/** A shop's page for a wish, with its price there (SPEC 7.6); `list_id` too, so a policy never joins. */
export const wishLinks = sqliteTable(
  "wish_links",
  {
    ...syncColumns,
    listId: text("list_id").notNull(),
    wishId: text("wish_id").notNull(),
    url: text("url").notNull(),
    priceMinor: integer("price_minor"),
    /** When a phone last read its page, whatever it found (SPEC 7.2). */
    readAt: text("read_at"),
  },
  (t) => [index("idx_wish_links_wish_id").on(t.wishId)],
);

/**
 * A product as its person keeps it, one row per product whatever list it is
 * on: its id comes from the folded name. It holds the star (SPEC 5.1) and
 * the aisle it was moved to (5.4). Personal; the
 * person joins its id with accounts, as a pantry row's.
 */
export const products = sqliteTable("products", {
  ...syncColumns,
  name: text("name").notNull(),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  /** Where the person put it, over the catalogue's aisle (SPEC 5.4); none keeps the catalogue's. */
  aisle: text("aisle", { enum: AISLES }),
});

/** A ready-made set (SPEC 5.3), "Kahvaltı", that goes onto a list in one tap. Personal, as a product is. */
export const sets = sqliteTable("sets", {
  ...syncColumns,
  name: text("name").notNull(),
});

/** What a set holds, in the order it was made in; one row per product. */
export const setItems = sqliteTable(
  "set_items",
  {
    ...syncColumns,
    setId: text("set_id").notNull(),
    name: text("name").notNull(),
    quantityMilli: integer("quantity_milli"),
    unit: text("unit", { enum: UNITS }),
    note: text("note"),
    position: integer("position").notNull(),
  },
  (t) => [index("idx_set_items_set_id").on(t.setId)],
);

/**
 * A product at home (SPEC 12.2), one row per product: its id comes from the
 * folded name, so every shop that brings it meets the same row. What it holds
 * is not a column but the sum of its moves (`docs/ARCHITECTURE.md`, "The pantry
 * counts arrivals"). Personal, not a list's; the person joins its id with accounts.
 */
export const pantryItems = sqliteTable("pantry_items", {
  ...syncColumns,
  name: text("name").notNull(),
  /** The list its latest arrival was bought on, where finishing it puts it back. */
  listId: text("list_id"),
  /** The day printed on it (SPEC 12.3), a local `YYYY-MM-DD`; it goes when the product is finished. */
  expiresOn: text("expires_on"),
  /** Its place in Kiler once dragged (SPEC 4.1 there); 0 until then, so an arrival lands on top. */
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * What arrived at home (positive) or was used (negative), in thousandths of
 * `unit` (SPEC 12.8). An arrival's id comes from the bought item it records,
 * so a shop seen twice adds once (12.9).
 */
export const pantryMoves = sqliteTable(
  "pantry_moves",
  {
    ...syncColumns,
    pantryItemId: text("pantry_item_id").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unit: text("unit", { enum: UNITS }).notNull(),
  },
  (t) => [index("idx_pantry_moves_pantry_item_id").on(t.pantryItemId)],
);

/**
 * What follows the person to every device, Helix's key and JSON value: today
 * whether the account is frozen (SPEC 9.1). The id comes from the key
 * (`src/db/ids.ts`), so two devices writing one setting meet one row.
 */
export const settings = sqliteTable("settings", {
  ...syncColumns,
  key: text("key").notNull(),
  value: text("value").notNull(),
});

/**
 * Local only: a photo's bytes, as JPEG data URIs. A row names it by id; the
 * bytes never ride the outbox, because the decision of 2026-09-23 puts them
 * in Storage, beside the row rather than in it. A photo is never edited — a
 * new one is a new id — so an undo that puts the old id back finds it here.
 */
export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  /** The longest edge at most `PHOTO_EDGE`, for the panel. */
  data: text("data").notNull(),
  /** At most `THUMB_EDGE`, for a row's tile, so a list never decodes the full photo. */
  thumb: text("thumb").notNull(),
  createdAt: text("created_at").notNull(),
  /** When Storage took both sizes, or when they came from it; `null` is still to send. */
  uploadedAt: text("uploaded_at"),
});

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

/**
 * Local only: an outbox event the push would not send, or the server would not
 * take (SPEC 10.3). The row itself stays as it is on the device; this is the
 * clue, kept until a retry sends it or the person dismisses it.
 */
export const syncDeadLetters = sqliteTable("sync_dead_letters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  outboxId: integer("outbox_id").notNull().unique(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  payload: text("payload").notNull(),
  reason: text("reason", { enum: ["malformed_payload", "invalid_row", "refused"] }).notNull(),
  quarantinedAt: text("quarantined_at").notNull(),
});

/** Local only: how far each table has been pulled, as `"<updated_at>|<id>"`. */
export const syncState = sqliteTable("sync_state", {
  tableName: text("table_name").primaryKey(),
  lastPulledAt: text("last_pulled_at").notNull(),
});

/**
 * The `sync_state` key under which `migrateDb` names the columns an update
 * added, as a JSON list, until the pull after it has finished: the push leaves
 * such a column out while it holds the migration's empty value.
 */
export const UNPULLED = "unpulled:";

/** Parents before children, the order a push sends them in: the server checks an item's list. */
export const SYNCED_TABLES = { lists, list_members: listMembers, shops, items, wishes, wish_links: wishLinks, products, sets, set_items: setItems, pantry_items: pantryItems, pantry_moves: pantryMoves, settings } as const;

export type SyncedTableName = keyof typeof SYNCED_TABLES;
