/**
 * A shared list's members (SPEC 1.2, 1.4). The server makes every row; the
 * device only takes one away — a member who leaves, or one the owner removes —
 * changes a role, or says when its person last looked (SPEC 1.9), and the
 * server keeps anything else as it was.
 */

import { and, asc, count, desc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { editRow, nowIso, readLiveRow, writeRows } from "../db/mutations";
import { items, listMembers, type MemberRole } from "../db/schema";
import { initialOf } from "../domain/names";

export interface Member {
  id: string;
  userId: string;
  role: MemberRole;
  name: string;
  seenAt: string | null;
}

/** The owner first, then in the order they joined. */
export function readMembers(listId: string): Promise<Member[]> {
  return getDb()
    .select({
      id: listMembers.id,
      userId: listMembers.userId,
      role: listMembers.role,
      name: listMembers.name,
      seenAt: listMembers.seenAt,
    })
    .from(listMembers)
    .where(and(eq(listMembers.listId, listId), isNull(listMembers.deletedAt)))
    .orderBy(desc(sql`${listMembers.role} = 'owner'`), asc(listMembers.createdAt), asc(listMembers.id));
}

/** A list nobody else is in has no rows yet, and is its maker's. */
export function roleOf(members: readonly Member[], userId: string): MemberRole {
  return members.find((member) => member.userId === userId)?.role ?? "owner";
}

export interface RowPeople {
  fresh: boolean;
  /** Initials; `null` on a list nobody shares, or from someone no longer in it. */
  added: string | null;
  checked: string | null;
}

/**
 * Who added a row and who ticked it (SPEC 1.5), and whether it is new to
 * `userId` (SPEC 1.9): added by someone else after this person's last look.
 * Both times are devices' — the adder's and the looker's — never the server's,
 * whose clock a row's `created_at` does not carry; so two phones' drift is the
 * only error. Before a first look nothing is new: joining brings a whole list.
 */
export function rowPeople(
  item: { addedBy: string | null; checkedBy: string | null; createdAt: string },
  members: readonly Member[],
  userId: string,
): RowPeople {
  const mine = members.find((member) => member.userId === userId);
  if (!mine || members.length < 2) return { fresh: false, added: null, checked: null };
  const initial = (id: string | null) => {
    const who = members.find((member) => member.userId === id);
    return who?.name ? initialOf(who.name) : null;
  };
  return {
    fresh: item.addedBy != null && item.addedBy !== userId && mine.seenAt != null && item.createdAt > mine.seenAt,
    added: initial(item.addedBy),
    checked: initial(item.checkedBy),
  };
}

/** Each shared list's count of what is new to `userId`, for its card; `rowPeople`'s rule in one query, where a look never taken compares as null and counts nothing. */
export function readFresh(userId: string): Promise<{ listId: string; count: number }[]> {
  return getDb()
    .select({ listId: items.listId, count: count(items.id) })
    .from(items)
    .innerJoin(listMembers, and(eq(listMembers.listId, items.listId), eq(listMembers.userId, userId), isNull(listMembers.deletedAt)))
    .where(
      and(
        isNull(items.deletedAt),
        isNull(items.shopId),
        isNotNull(items.addedBy),
        ne(items.addedBy, userId),
        gt(items.createdAt, listMembers.seenAt),
      ),
    )
    .groupBy(items.listId);
}

/** The lists `userId` shares with someone still in them: those worth a live channel (SPEC 1.3). */
export async function readSharedLists(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ listId: listMembers.listId })
    .from(listMembers)
    .where(isNull(listMembers.deletedAt))
    .groupBy(listMembers.listId)
    .having(sql`count(*) > 1 and max(${listMembers.userId} = ${userId})`)
    .orderBy(asc(listMembers.listId));
  return rows.map((row) => row.listId);
}

/** Leaving a list's screen: what was new has been seen. A list nobody shares has nothing to mark. */
export async function markSeen(listId: string, userId: string): Promise<void> {
  const [mine] = (await readMembers(listId)).filter((member) => member.userId === userId);
  if (mine) await editMember(mine.id, { seenAt: nowIso() });
}

async function editMember(id: string, patch: Record<string, unknown>): Promise<void> {
  await writeRows(async () => editRow("list_members", await readLiveRow("list_members", id), patch));
}

export const removeMember = (id: string) => editMember(id, { deletedAt: nowIso() });

export const setMemberRole = (id: string, role: Exclude<MemberRole, "owner">) => editMember(id, { role });

/** Leave a list someone else owns; the device lets it go once the server has heard. */
export async function leaveList(listId: string, userId: string): Promise<void> {
  const [mine] = (await readMembers(listId)).filter((member) => member.userId === userId);
  if (mine) await removeMember(mine.id);
}
