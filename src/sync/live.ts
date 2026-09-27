/**
 * A shared list, live (SPEC 1.3, 1.6): each has a private Realtime channel,
 * `list:<id>`, which only its members may hear (migration 6). The server says
 * there that the list moved, and the rows still come by the pull, so a nudge
 * lost to a dropped socket costs only the wait for the half-minute poll. Its
 * members say there who is shopping, as presence, which nothing stores.
 *
 * The transport loads when a shared list first needs it, in a chunk of its
 * own: `metro.config.js` keeps supabase-js's eager copy out of the entry.
 */

import { create } from "zustand";
import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";

export interface LiveOptions {
  url: string;
  apiKey: string;
  accessToken: () => Promise<string | null>;
  userId: string;
  /** Someone else moved the list: time to pull. */
  onMoved: (listId: string) => void;
}

/** Who else is shopping each followed list now, by user id. */
export const useShoppers = create<{ byList: Record<string, readonly string[]> }>(() => ({ byList: {} }));

let session: { client: RealtimeClient; options: LiveOptions; channels: Map<string, RealtimeChannel> } | null = null;
let wanted: readonly string[] = [];
let shoppingIn: string | null = null;
// A start overtaken by a stop, or by another start, opens nothing.
let generation = 0;

const quietly = (work: Promise<unknown>) => void work.catch(() => {});

export async function startLive(options: LiveOptions): Promise<void> {
  const run = ++generation;
  const { RealtimeClient } = await import("@supabase/realtime-js");
  if (run !== generation) return;
  close();
  const client = new RealtimeClient(`${options.url}/realtime/v1`, { params: { apikey: options.apiKey }, accessToken: options.accessToken });
  session = { client, options, channels: new Map() };
  follow();
}

/** Signing out: every channel closes, and what it knew goes with it. */
export function stopLive(): void {
  generation++;
  close();
  wanted = [];
  shoppingIn = null;
}

/** The lists to be live: those the person shares with someone. */
export function followLists(listIds: readonly string[]): void {
  wanted = listIds;
  follow();
}

/** The list this person is shopping now, or null when none. */
export function setShopping(listId: string | null): void {
  const before = shoppingIn;
  shoppingIn = listId;
  const channels = session?.channels;
  if (before && before !== listId) quietly(channels?.get(before)?.untrack() ?? Promise.resolve());
  if (listId) quietly(channels?.get(listId)?.track({ shopping: true }) ?? Promise.resolve());
}

function close(): void {
  const was = session;
  session = null;
  useShoppers.setState({ byList: {} });
  if (was) quietly(was.client.disconnect());
}

function follow(): void {
  if (!session) return;
  const { client, channels, options } = session;
  for (const [listId, channel] of channels) {
    if (wanted.includes(listId)) continue;
    channels.delete(listId);
    quietly(client.removeChannel(channel));
    const { [listId]: _gone, ...rest } = useShoppers.getState().byList;
    useShoppers.setState({ byList: rest });
  }
  for (const listId of wanted) {
    if (channels.has(listId)) continue;
    const channel = client.channel(`list:${listId}`, { config: { private: true, presence: { key: options.userId } } });
    channel
      .on("broadcast", { event: "moved" }, ({ payload }) => {
        if (payload?.by !== options.userId) options.onMoved(listId);
      })
      .on("presence", { event: "sync" }, () => {
        const others = Object.keys(channel.presenceState()).filter((userId) => userId !== options.userId);
        useShoppers.setState({ byList: { ...useShoppers.getState().byList, [listId]: others } });
      })
      // A rejoin — a dropped socket, a new token — forgets what was tracked.
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && shoppingIn === listId) quietly(channel.track({ shopping: true }));
      });
    channels.set(listId, channel);
  }
}
