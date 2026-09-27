/**
 * Invitations (SPEC 1.4): migration 5's two server functions. Online only,
 * since only the server adds a member. The token rides a link's fragment,
 * which no server along the way logs, and works once.
 */

import { tr } from "../i18n/tr";
import { isNetworkFailure } from "./status";
import { getSupabase } from "./supabase";

export type InviteRole = "editor" | "viewer";

const INVITE_PAGE = "https://topraksv.github.io/gital/invite";
const TOKEN = /^[0-9a-f]{64}$/;

export const inviteLink = (token: string) => `${INVITE_PAGE}#${token}`;

/**
 * The token a web invitation opened with, read once at launch: signing in
 * first sends the page elsewhere and the fragment with it.
 */
export function inviteFromPage(page: { pathname: string; hash: string } | undefined): string | null {
  return page && /\/invite\/?$/.test(page.pathname) ? inviteTokenFrom(page.hash.slice(1)) : null;
}

/** The token in a pasted or scanned link, or in the bare token itself. */
export function inviteTokenFrom(text: string): string | null {
  const trimmed = text.trim();
  const token = trimmed.startsWith(`${INVITE_PAGE}#`) ? trimmed.slice(INVITE_PAGE.length + 1) : trimmed;
  return TOKEN.test(token) ? token : null;
}

type Refused = { refused: string };

async function call<T>(name: string, args: Record<string, unknown>): Promise<{ data: T } | Refused> {
  const supabase = getSupabase();
  if (!supabase) return { refused: tr.auth.errNotConfigured };
  // supabase-js answers a failed fetch with an error rather than throwing.
  const { data, error } = await supabase.rpc(name, args);
  if (!error) return { data: data as T };
  if (error.code === "42501") return { refused: tr.sharing.errNotOwner };
  if (error.code === "22023") return { refused: tr.sharing.errInvite };
  return { refused: isNetworkFailure(error.message) ? tr.sync.errNetwork : tr.sharing.errGeneric };
}

/** The owner's link for one person, who joins as `role`. */
export async function createInvite(listId: string, role: InviteRole, ownerName: string): Promise<{ token: string } | Refused> {
  const answer = await call<string>("create_list_invite", { list: listId, invite_role: role, owner_name: ownerName });
  return "data" in answer ? { token: answer.data } : answer;
}

/**
 * The owner's link, sending the list first only when the server does not hold
 * it yet. Syncing before every invite made the button wait on a whole sync,
 * photos included, and on a slow line it looked like it did nothing.
 */
export async function inviteToList(listId: string, role: InviteRole, ownerName: string, sendList: () => Promise<unknown>): Promise<{ token: string } | Refused> {
  const first = await createInvite(listId, role, ownerName);
  if (!("refused" in first) || first.refused !== tr.sharing.errNotOwner) return first;
  await sendList();
  return createInvite(listId, role, ownerName);
}

/** Join by a link; the list arrives with the next sync. */
export async function acceptInvite(token: string, name: string): Promise<{ listId: string } | Refused> {
  const answer = await call<string>("accept_list_invite", { token, member_name: name });
  return "data" in answer ? { listId: answer.data } : answer;
}
