/**
 * A shared list's members (SPEC 1.2, 1.4). The server makes every row; the
 * device only takes one away — a member who leaves, or one the owner removes —
 * or changes a role, and the server keeps anything else as it was.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { editRow, nowIso, readLiveRow, writeRows } from "../db/mutations";
import { listMembers, type MemberRole } from "../db/schema";

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
    .select({ id: listMembers.id, userId: listMembers.userId, role: listMembers.role, name: listMembers.name, seenAt: listMembers.seenAt })
    .from(listMembers)
    .where(and(eq(listMembers.listId, listId), isNull(listMembers.deletedAt)))
    .orderBy(desc(sql`${listMembers.role} = 'owner'`), asc(listMembers.createdAt), asc(listMembers.id));
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
