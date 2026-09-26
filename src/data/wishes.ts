/** The wish collections, their wishes, and what İstekler can do to one (SPEC 7). */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, getSqliteAsync } from "../db/client";
import { deleteRow, editRow, fromDbShape, nowIso, readLiveRow, writeRows, type RowSnapshot, type RowWrite, type RowsWritten } from "../db/mutations";
import { lists, wishLinks, wishes } from "../db/schema";
import { itemNameFrom, noteFrom } from "../domain/items";
import { lookOf, type ListLook } from "../domain/lists";
import { isPrice } from "../domain/money";
import { PRIORITIES, isLinkLike, linkFrom, openTotal, shopOf, sortWishes, type Priority, type Wish } from "../domain/wishes";

export interface Collection extends ListLook {
  id: string;
  /** Wishes not yet bought. */
  open: number;
  openTotalMinor: number | null;
}

/** What the wish panel saves; a link without an id is a new one. */
export interface WishChange {
  name: string;
  note: string;
  priority: Priority;
  estimateMinor: number | null;
  links: readonly { id?: string; url: string; priceMinor: number | null }[];
}

async function readAll(listIds: readonly string[]): Promise<Map<string, Wish[]>> {
  const byList = new Map<string, Wish[]>(listIds.map((id) => [id, []]));
  if (listIds.length === 0) return byList;
  const db = getDb();
  const [wishRows, linkRows] = await Promise.all([
    db.select().from(wishes).where(and(inArray(wishes.listId, [...listIds]), isNull(wishes.deletedAt))),
    db
      .select({ id: wishLinks.id, wishId: wishLinks.wishId, url: wishLinks.url, priceMinor: wishLinks.priceMinor })
      .from(wishLinks)
      .where(and(inArray(wishLinks.listId, [...listIds]), isNull(wishLinks.deletedAt)))
      .orderBy(asc(wishLinks.createdAt), asc(wishLinks.id)),
  ]);
  // Not `Map.groupBy`, which Hermes may not have.
  const links = new Map<string, typeof linkRows>();
  for (const link of linkRows) links.set(link.wishId, [...(links.get(link.wishId) ?? []), link]);
  for (const row of wishRows) {
    byList.get(row.listId)?.push({
      id: row.id,
      name: row.name,
      note: row.note,
      priority: PRIORITIES.includes(row.priority as Priority) ? (row.priority as Priority) : 1,
      estimateMinor: row.estimateMinor,
      boughtAt: row.boughtAt,
      createdAt: row.createdAt,
      links: (links.get(row.id) ?? []).map(({ id, url, priceMinor }) => ({ id, url, priceMinor })),
    });
  }
  return byList;
}

/** Oldest first, as Listeler's lists are. */
export async function readCollections(): Promise<Collection[]> {
  const rows = await getDb()
    .select({ id: lists.id, name: lists.name, color: lists.color, icon: lists.icon })
    .from(lists)
    .where(and(isNull(lists.deletedAt), eq(lists.kind, "wish")))
    .orderBy(asc(lists.createdAt), asc(lists.id));
  const all = await readAll(rows.map((row) => row.id));
  return rows.map((row) => {
    const held = all.get(row.id) ?? [];
    return { ...lookOf(row), id: row.id, open: held.filter((wish) => wish.boughtAt == null).length, openTotalMinor: openTotal(held) };
  });
}

export async function readWishes(listId: string): Promise<Wish[]> {
  return sortWishes((await readAll([listId])).get(listId) ?? []);
}

/** A live wish collection, or a refusal: a wish never lands on a shopping list or a deleted one. */
async function readCollection(listId: string): Promise<void> {
  const list = await readLiveRow("lists", listId);
  if (list.kind !== "wish") throw new Error("Not a wish collection");
}

/**
 * A name, or a pasted link: a link becomes a wish named after its shop that
 * holds it, to be renamed in its panel.
 */
export async function addWish(listId: string, input: string): Promise<string> {
  const url = isLinkLike(input) ? linkFrom(input) : null;
  const name = itemNameFrom(url ? shopOf(url) : input);
  if (name == null) throw new Error("A wish needs a name");
  const id = uuidv7();
  await writeRows(async () => {
    await readCollection(listId);
    const writes: RowWrite[] = [{ table: "wishes", row: { id, listId, name } }];
    if (url) writes.push({ table: "wish_links", row: { id: uuidv7(), listId, wishId: id, url } });
    return writes;
  });
  return id;
}

function priceOrThrow(minor: number | null): number | null {
  if (minor != null && !isPrice(minor)) throw new Error("Not a price");
  return minor;
}

/** The panel's save: the wish and every link in one write, a dropped link deleted. */
export async function saveWish(id: string, change: WishChange): Promise<void> {
  const name = itemNameFrom(change.name);
  if (name == null) throw new Error("A wish needs a name");
  if (!PRIORITIES.includes(change.priority)) throw new Error("An unknown priority");
  const estimateMinor = priceOrThrow(change.estimateMinor);
  const links = change.links.map((link) => {
    const url = linkFrom(link.url);
    if (url == null) throw new Error("Not a web link");
    return { id: link.id, url, priceMinor: priceOrThrow(link.priceMinor) };
  });
  return writeRows(async () => {
    const stored = await readLiveRow("wishes", id);
    const listId = String(stored.list_id);
    await readCollection(listId);
    const sqlite = await getSqliteAsync();
    const held = new Map(
      (await sqlite.getAllAsync<RowSnapshot>("SELECT * FROM wish_links WHERE wish_id = ? AND deleted_at IS NULL", [id])).map((row) => [row.id as string, row]),
    );
    const writes: RowWrite[] = editRow("wishes", stored, { name, note: noteFrom(change.note), priority: change.priority, estimateMinor });
    for (const link of links) {
      if (link.id == null) {
        writes.push({ table: "wish_links", row: { id: uuidv7(), listId, wishId: id, url: link.url, priceMinor: link.priceMinor } });
        continue;
      }
      const kept = held.get(link.id);
      if (!kept) throw new Error("A link of another wish");
      held.delete(link.id);
      writes.push(...editRow("wish_links", kept, { url: link.url, priceMinor: link.priceMinor }));
    }
    const deletedAt = nowIso();
    for (const dropped of held.values()) writes.push({ table: "wish_links", row: { ...fromDbShape("wish_links", dropped), deletedAt } });
    return writes;
  });
}

export function toggleWishBought(id: string): Promise<void> {
  return writeRows(async () => {
    const stored = await readLiveRow("wishes", id);
    return editRow("wishes", stored, { boughtAt: stored.bought_at == null ? nowIso() : null });
  });
}

/** Its links stay under the tombstone, out of every read, so undo needs only the wish. */
export function deleteWish(id: string): Promise<RowsWritten | null> {
  return deleteRow("wishes", id);
}

export { undoRows as restoreWish } from "../db/mutations";

