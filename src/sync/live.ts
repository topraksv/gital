/**
 * A shared list, live (SPEC 1.3, 1.6): each has a private Realtime channel,
 * `list:<id>`, which only its members may hear (migration 6). The server says
 * there that the list moved, and the rows still come by the pull, so a nudge
 * lost to a dropped socket costs only the wait for the half-minute poll. Who is
 * shopping is not said here: it is read from ticks (`src/domain/shopping.ts`).
 * Each person also hears `user:<id>` (migration 17), where they are told that
 * their place in a list changed: removed, they no longer hear the list's own.
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
  /** Someone else moved a list, or the person's place in one: time to pull. */
  onMoved: () => void;
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
  const own = `user:${options.userId}`;
  const topics = [own, ...wanted.map((listId) => `list:${listId}`)];
  for (const [topic, channel] of channels) {
    if (topics.includes(topic)) continue;
    channels.delete(topic);
    quietly(client.removeChannel(channel));
  }
  for (const topic of topics) {
    if (channels.has(topic)) continue;
    const channel = client.channel(topic, { config: { private: true } });
    channel
      .on("broadcast", { event: "moved" }, ({ payload }) => {
        // On their own channel, the person's other device left or was moved too.
        if (topic === own || payload?.by !== options.userId) options.onMoved();
      })
      .subscribe();
    channels.set(topic, channel);
  }
}
