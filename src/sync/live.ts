/**
 * A shared list, live (SPEC 1.3, 1.6): each has a private Realtime channel,
 * `list:<id>`, which only its members may hear (migration 6). The server says
 * there that the list moved, and the rows still come by the pull, so a nudge
 * lost to a dropped socket costs only the wait for the half-minute poll. Who is
 * shopping is not said here: it is read from ticks (`src/domain/shopping.ts`).
 *
 * The transport loads when a shared list first needs it, in a chunk of its
 * own: `metro.config.js` keeps supabase-js's eager copy out of the entry.
 */

import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";

export interface LiveOptions {
  url: string;
  apiKey: string;
  accessToken: () => Promise<string | null>;
  userId: string;
  /** Someone else moved the list: time to pull. */
  onMoved: (listId: string) => void;
}

let session: { client: RealtimeClient; options: LiveOptions; channels: Map<string, RealtimeChannel> } | null = null;
let wanted: readonly string[] = [];
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
}

/** The lists to be live: those the person shares with someone. */
export function followLists(listIds: readonly string[]): void {
  wanted = listIds;
  follow();
}

function close(): void {
  const was = session;
  session = null;
  if (was) quietly(was.client.disconnect());
}

function follow(): void {
  if (!session) return;
  const { client, channels, options } = session;
  for (const [listId, channel] of channels) {
    if (wanted.includes(listId)) continue;
    channels.delete(listId);
    quietly(client.removeChannel(channel));
  }
  for (const listId of wanted) {
    if (channels.has(listId)) continue;
    const channel = client.channel(`list:${listId}`, { config: { private: true } });
    channel
      .on("broadcast", { event: "moved" }, ({ payload }) => {
        if (payload?.by !== options.userId) options.onMoved(listId);
      })
      .subscribe();
    channels.set(listId, channel);
  }
}
