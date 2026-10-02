/** The wish collections, their wishes, and what İstekler can do to one (SPEC 7). */

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, getSqliteAsync } from "../db/client";
import { deleteRows, editRow, findLiveRow, fromDbShape, nowIso, readLiveRow, writeRows, type RowSnapshot, type RowWrite, type RowsWritten } from "../db/mutations";
import { lists, photos, wishLinks, wishes } from "../db/schema";
import { isISODate, type ISODate } from "../domain/dates";
import { itemNameFrom, knownFrom, noteFrom, type KnownProduct } from "../domain/items";
import { lookOf, type ListLook } from "../domain/lists";
import { isPrice } from "../domain/money";
import { owning, viewing } from "./lists";
import { photoColumn, type NewPhoto, type PhotoChange } from "./photos";
import { PRIORITIES, isNamedByLink, linkFrom, linkIn, openTotal, shopOf, sortWishes, type Priority, type Wish } from "../domain/wishes";

export interface Collection extends ListLook {
  id: string;
  /** Wishes not yet bought. */
  open: number;
  openTotalMinor: number | null;
  /** Shared with this person to read, so a pasted link goes elsewhere. */
  viewer: boolean;
  owner: boolean;
}

/** What the wish panel saves; a link without an id is a new one. */
export interface WishChange {
  name: string;
  note: string;
  priority: Priority;
  estimateMinor: number | null;
  dueOn: ISODate | null;
  links: readonly { id?: string; url: string; priceMinor: number | null }[];
  photo?: PhotoChange;
}

async function readAll(listIds: readonly string[]): Promise<Map<string, Wish[]>> {
  const byList = new Map<string, Wish[]>(listIds.map((id) => [id, []]));
  if (listIds.length === 0) return byList;
  const db = getDb();
  const [wishRows, linkRows] = await Promise.all([
    db
      .select({ wish: wishes, photo: photos.thumb })
      .from(wishes)
      .leftJoin(photos, eq(photos.id, wishes.photoId))
      .where(and(inArray(wishes.listId, [...listIds]), isNull(wishes.deletedAt))),
    db
      .select({ id: wishLinks.id, wishId: wishLinks.wishId, url: wishLinks.url, priceMinor: wishLinks.priceMinor })
      .from(wishLinks)
      .where(and(inArray(wishLinks.listId, [...listIds]), isNull(wishLinks.deletedAt)))
      .orderBy(asc(wishLinks.createdAt), asc(wishLinks.id)),
  ]);
  // Not `Map.groupBy`, which Hermes may not have.
  const links = new Map<string, typeof linkRows>();
  for (const link of linkRows) links.set(link.wishId, [...(links.get(link.wishId) ?? []), link]);
  for (const { wish: row, photo } of wishRows) {
    byList.get(row.listId)?.push({
      id: row.id,
      name: row.name,
      note: row.note,
      priority: PRIORITIES.includes(row.priority as Priority) ? (row.priority as Priority) : 1,
      estimateMinor: row.estimateMinor,
      boughtAt: row.boughtAt,
      createdAt: row.createdAt,
      photoId: row.photoId,
      photo,
      dueOn: row.dueOn != null && isISODate(row.dueOn) ? row.dueOn : null,
      links: (links.get(row.id) ?? []).map(({ id, url, priceMinor }) => ({ id, url, priceMinor })),
    });
  }
  return byList;
}

/** Oldest first, as Listeler's lists are. */
export async function readCollections(): Promise<Collection[]> {
  const rows = await getDb()
    .select({ id: lists.id, name: lists.name, color: lists.color, icon: lists.icon, viewer: viewing(), owner: owning() })
    .from(lists)
    .where(and(isNull(lists.deletedAt), eq(lists.kind, "wish")))
    .orderBy(asc(lists.createdAt), asc(lists.id));
  const all = await readAll(rows.map((row) => row.id));
  return rows.map((row) => {
    const held = all.get(row.id) ?? [];
    return { ...lookOf(row), id: row.id, open: held.filter((wish) => wish.boughtAt == null).length, openTotalMinor: openTotal(held) };
  });
}

/** Every live wish's date, for the reminders (SPEC 12.1). */
export async function readDueWishes(): Promise<{ name: string; dueOn: ISODate; boughtAt: string | null }[]> {
  const rows = await getDb()
    .select({ name: wishes.name, dueOn: wishes.dueOn, boughtAt: wishes.boughtAt })
    .from(wishes)
    .innerJoin(lists, and(eq(lists.id, wishes.listId), isNull(lists.deletedAt)))
    .where(and(isNull(wishes.deletedAt), isNotNull(wishes.dueOn)));
  return rows.flatMap(({ name, dueOn, boughtAt }) => (dueOn != null && isISODate(dueOn) ? [{ name, dueOn, boughtAt }] : []));
}

/**
 * Every wish named before, in a live collection, for the add field's
 * suggestions, shaped as the list's products are so one ranking serves both.
 */
export async function readKnownWishes(): Promise<KnownProduct[]> {
  const rows = await getDb()
    .select({ name: wishes.name, times: count() })
    .from(wishes)
    .innerJoin(lists, and(eq(lists.id, wishes.listId), isNull(lists.deletedAt)))
    .where(isNull(wishes.deletedAt))
    .groupBy(wishes.name)
    .orderBy(desc(max(wishes.updatedAt)), asc(wishes.name));
  return knownFrom(rows);
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
 * holds it, to be renamed by its page or in its panel. What a share sheet
 * wrote around the link is kept as the note.
 */
export async function addWish(listId: string, input: string): Promise<string> {
  const link = linkIn(input);
  const name = itemNameFrom(link ? shopOf(link.url) : input);
  if (name == null) throw new Error("A wish needs a name");
  const id = uuidv7();
  await writeRows(async () => {
    await readCollection(listId);
    const writes: RowWrite[] = [{ table: "wishes", row: { id, listId, name, note: noteFrom(link?.said) } }];
    if (link) writes.push({ table: "wish_links", row: { id: uuidv7(), listId, wishId: id, url: link.url } });
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
  if (change.dueOn != null && !isISODate(change.dueOn)) throw new Error("A wish's date is a calendar day");
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
    const writes: RowWrite[] = editRow("wishes", stored, { name, note: noteFrom(change.note), priority: change.priority, estimateMinor, dueOn: change.dueOn, ...(await photoColumn(change.photo)) });
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

/** A wish's links with no price yet: the pages worth reading (SPEC 7.2). */
export async function unpricedLinksOf(wishId: string): Promise<{ id: string; url: string }[]> {
  return getDb()
    .select({ id: wishLinks.id, url: wishLinks.url })
    .from(wishLinks)
    .where(and(eq(wishLinks.wishId, wishId), isNull(wishLinks.priceMinor), isNull(wishLinks.deletedAt)))
    .orderBy(asc(wishLinks.createdAt), asc(wishLinks.id));
}

/**
 * What a link's page said (SPEC 7.2), filling only what is still empty: a
 * name still the shop's, a link with no price, a wish with no photo. The page
 * is read after the add returns, and by then the person may have written
 * their own; theirs is kept. Nothing is written for a wish gone meanwhile.
 */
export async function fillFromPage(linkId: string, found: { name?: string | null; priceMinor?: number | null; photo?: NewPhoto | null }): Promise<void> {
  await writeRows(async () => {
    const link = await findLiveRow("wish_links", linkId);
    const wish = link && (await findLiveRow("wishes", String(link.wish_id)));
    if (!link || !wish) return [];
    const name = found.name != null && isNamedByLink(String(wish.name), String(link.url)) ? itemNameFrom(found.name) : null;
    const photo = found.photo != null && wish.photo_id == null ? await photoColumn(found.photo) : {};
    return [
      ...editRow("wishes", wish, { ...(name ? { name } : {}), ...photo }),
      ...(link.price_minor == null && found.priceMinor != null ? editRow("wish_links", link, { priceMinor: priceOrThrow(found.priceMinor) }) : []),
    ];
  });
}

export function toggleWishBought(id: string): Promise<void> {
  return writeRows(async () => {
    const stored = await readLiveRow("wishes", id);
    return editRow("wishes", stored, { boughtAt: stored.bought_at == null ? nowIso() : null });
  });
}

/** Its links stay under the tombstone, out of every read, so undo needs only the wish. */
export function deleteWishes(ids: readonly string[]): Promise<RowsWritten | null> {
  return deleteRows("wishes", ids);
}

export { undoRows as restoreWish } from "../db/mutations";

