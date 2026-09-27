import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: { payload?: Record<string, unknown> }) => void;

class FakeChannel {
  handlers = new Map<string, Handler>();
  tracked: Record<string, unknown> | null = null;
  state: Record<string, unknown[]> = {};
  onStatus: ((status: string) => void) | null = null;
  constructor(
    readonly topic: string,
    readonly options: unknown,
  ) {}
  on(type: string, filter: { event: string }, handler: Handler) {
    this.handlers.set(`${type}:${filter.event}`, handler);
    return this;
  }
  subscribe(callback: (status: string) => void) {
    this.onStatus = callback;
    return this;
  }
  track = vi.fn(async (payload: Record<string, unknown>) => {
    this.tracked = payload;
    return "ok";
  });
  untrack = vi.fn(async () => {
    this.tracked = null;
    return "ok";
  });
  presenceState() {
    return this.state;
  }
  emit(key: string, payload?: Record<string, unknown>) {
    this.handlers.get(key)!({ payload });
  }
}

const clients: FakeClient[] = [];
class FakeClient {
  channels: FakeChannel[] = [];
  removed: FakeChannel[] = [];
  disconnected = false;
  constructor(
    readonly endpoint: string,
    readonly options: { params: { apikey: string }; accessToken: () => Promise<string | null> },
  ) {
    clients.push(this);
  }
  channel(topic: string, options: unknown) {
    const made = new FakeChannel(topic, options);
    this.channels.push(made);
    return made;
  }
  removeChannel = vi.fn(async (channel: FakeChannel) => {
    this.removed.push(channel);
    return "ok";
  });
  disconnect = vi.fn(async () => {
    this.disconnected = true;
    return "ok";
  });
}

vi.mock("@supabase/realtime-js", () => ({ RealtimeClient: FakeClient }));

const { followLists, setShopping, startLive, stopLive, useShoppers } = await import("../../src/sync/live");

const ME = "10000000-0000-4000-8000-000000000001";
const HER = "20000000-0000-4000-8000-000000000002";
const accessToken = async () => "jwt";
const onMoved = vi.fn();
const start = () => startLive({ url: "https://x.supabase.co", apiKey: "anon", accessToken, userId: ME, onMoved });
const client = () => clients.at(-1)!;
const channelOf = (listId: string) => client().channels.find((c) => c.topic === `list:${listId}`)!;

beforeEach(() => {
  clients.length = 0;
  onMoved.mockReset();
});
afterEach(() => stopLive());

describe("live lists", () => {
  it("joins each shared list's private channel, keyed by the person, with the project's key and their token", async () => {
    followLists(["a", "b"]);
    await start();
    expect(client().endpoint).toBe("https://x.supabase.co/realtime/v1");
    expect(client().options.params.apikey).toBe("anon");
    expect(await client().options.accessToken()).toBe("jwt");
    expect(client().channels.map((c) => c.topic)).toEqual(["list:a", "list:b"]);
    expect(channelOf("a").options).toEqual({ config: { private: true, presence: { key: ME } } });
  });

  it("follows the lists as they change: a new one joined, one left dropped, one kept not joined twice", async () => {
    await start();
    followLists(["a", "b"]);
    followLists(["b", "c"]);
    expect(client().channels.map((c) => c.topic)).toEqual(["list:a", "list:b", "list:c"]);
    expect(client().removed.map((c) => c.topic)).toEqual(["list:a"]);
  });

  it("pulls when someone else moved a list, and not for the person's own push", async () => {
    followLists(["a"]);
    await start();
    channelOf("a").emit("broadcast:moved", { by: HER });
    channelOf("a").emit("broadcast:moved", { by: ME });
    channelOf("a").emit("broadcast:moved");
    expect(onMoved).toHaveBeenCalledTimes(2);
  });

  it("says the person is shopping on that list alone, and stops saying it", async () => {
    followLists(["a", "b"]);
    await start();
    setShopping("a");
    expect(channelOf("a").tracked).toEqual({ shopping: true });
    setShopping("b");
    expect(channelOf("a").tracked).toBeNull();
    expect(channelOf("b").tracked).toEqual({ shopping: true });
    setShopping(null);
    expect(channelOf("b").tracked).toBeNull();
  });

  it("says it again each time the channel joins, since a rejoin forgets it", async () => {
    followLists(["a"]);
    setShopping("a");
    await start();
    channelOf("a").onStatus!("SUBSCRIBED");
    channelOf("a").onStatus!("SUBSCRIBED");
    expect(channelOf("a").track).toHaveBeenCalledTimes(2);
    setShopping(null);
    channelOf("a").onStatus!("SUBSCRIBED");
    channelOf("a").onStatus!("CHANNEL_ERROR");
    expect(channelOf("a").track).toHaveBeenCalledTimes(2);
  });

  it("knows who else is shopping on each list, and forgets a list it leaves", async () => {
    followLists(["a"]);
    await start();
    channelOf("a").state = { [ME]: [{ shopping: true }], [HER]: [{ shopping: true }] };
    channelOf("a").emit("presence:sync");
    expect(useShoppers.getState().byList).toEqual({ a: [HER] });
    followLists([]);
    expect(useShoppers.getState().byList).toEqual({});
  });

  it("ends everything on sign-out, and a start overtaken by it opens nothing", async () => {
    followLists(["a"]);
    await start();
    channelOf("a").state = { [HER]: [{}] };
    channelOf("a").emit("presence:sync");
    const first = client();
    const late = start();
    stopLive();
    await late;
    await Promise.resolve();
    expect(first.disconnected).toBe(true);
    expect(clients).toHaveLength(1);
    expect(useShoppers.getState().byList).toEqual({});
    followLists(["b"]);
    setShopping("b");
    expect(first.channels).toHaveLength(1);
  });

  it("starts again cleanly, following what it was told before", async () => {
    await start();
    followLists(["a"]);
    await start();
    expect(clients[0]!.disconnected).toBe(true);
    expect(client().channels.map((c) => c.topic)).toEqual(["list:a"]);
  });

  it("lets a refusal on the way pass quietly: the half-minute pull still comes", async () => {
    followLists(["a", "b"]);
    await start();
    channelOf("a").track.mockRejectedValueOnce(new Error("offline"));
    channelOf("a").untrack.mockRejectedValueOnce(new Error("offline"));
    client().removeChannel.mockRejectedValueOnce(new Error("offline"));
    client().disconnect.mockRejectedValueOnce(new Error("offline"));
    setShopping("a");
    setShopping(null);
    followLists(["b"]);
    stopLive();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
