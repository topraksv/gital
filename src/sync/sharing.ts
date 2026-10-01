/**
 * Invitations (SPEC 1.4): migration 5's server functions, and 12's look
 * before joining. Online only, since only the server adds a member. The token
 * rides a link's fragment, which no server along the way logs, and works once.
 */

import type { PantryItem } from "../data/pantry";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
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

const HELD_INVITE_KEY = "gital.invite";
const HELD_FOR_MS = 7 * 24 * 60 * 60 * 1000;
let held: string | null = null;

/**
 * A web invitation opened signed out, kept until a sign-in takes it (SPEC
 * 1.4). In memory, and in the browser too, since an e-mail confirmation opens
 * another tab and a reload starts afresh. For the link's own seven days at
 * most: the origin is Helix's as well, and the next account to sign in on
 * that browser must not be sent into someone else's list.
 */
export async function holdInvite(token: string): Promise<void> {
  held = token;
  await kv.set(HELD_INVITE_KEY, JSON.stringify({ token, at: Date.now() }));
}

/** The invitation held, if any; `take` lets it go, as the first signed-in read does. */
export async function heldInvite({ take = false } = {}): Promise<string | null> {
  let token = held;
  if (!token) {
    try {
      const stored = JSON.parse((await kv.get(HELD_INVITE_KEY)) ?? "null") as { token?: unknown; at?: unknown } | null;
      if (typeof stored?.at === "number" && Date.now() - stored.at < HELD_FOR_MS && typeof stored.token === "string") token = inviteTokenFrom(stored.token);
    } catch {
      // Unreadable is as good as none.
    }
  }
  if (take) {
    held = null;
    await kv.remove(HELD_INVITE_KEY);
  }
  return token;
}

/** The token in a pasted or scanned link, or in the bare token itself. */
export function inviteTokenFrom(text: string): string | null {
  const trimmed = text.trim();
  const token = trimmed.startsWith(`${INVITE_PAGE}#`) ? trimmed.slice(INVITE_PAGE.length + 1) : trimmed;
  return TOKEN.test(token) ? token : null;
}

type Refused = { refused: string };

/** The server's refusals, by SQLSTATE; a household's are migration 12's own, which no older version reads. */
const REFUSALS: Record<string, string> = {
  "42501": tr.sharing.errNotOwner,
  "22023": tr.sharing.errInvite,
  ZK001: tr.sharing.errOtherHousehold,
  ZK002: tr.sharing.errHasHousehold,
  ZK003: tr.sharing.errUpdate,
};

async function call<T>(name: string, args: Record<string, unknown>): Promise<{ data: T } | Refused> {
  const supabase = getSupabase();
  if (!supabase) return { refused: tr.auth.errNotConfigured };
  // supabase-js answers a failed fetch with an error rather than throwing.
  const { data, error } = await supabase.rpc(name, args);
  if (!error) return { data: data as T };
  return { refused: REFUSALS[error.code] ?? (isNetworkFailure(error.message) ? tr.sync.errNetwork : tr.sharing.errGeneric) };
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

/** What an invitation is to, and from whom, asked before it is spent. */
export interface InvitePeek {
  kind: "shop" | "wish" | "pantry";
  name: string;
  inviter: string;
}

/** `null` for a link that leads nowhere: used, expired, or its list gone. */
export async function peekInvite(token: string): Promise<InvitePeek | null | Refused> {
  const answer = await call<InvitePeek[]>("peek_list_invite", { token });
  return "data" in answer ? (answer.data[0] ?? null) : answer;
}

/**
 * Join by a link; the list arrives with the next sync. Into a household
 * (SPEC 12.13), `bring` is what the person's own Kiler holds and comes along —
 * empty to join with nothing. Each product goes as its stock, which the device
 * has already counted: the server adds it, and never re-counts moves.
 */
export async function acceptInvite(
  token: string,
  name: string,
  bring?: readonly Pick<PantryItem, "id" | "name" | "listId" | "expiresOn" | "quantityMilli" | "unit">[],
): Promise<{ listId: string } | Refused> {
  const pantry = bring?.map((item) => ({
    id: item.id,
    name: item.name,
    list_id: item.listId,
    expires_on: item.expiresOn,
    quantity_milli: item.quantityMilli,
    unit: item.unit,
  }));
  const answer = await call<string>("accept_list_invite", { token, member_name: name, ...(pantry && { pantry }) });
  return "data" in answer ? { listId: answer.data } : answer;
}
