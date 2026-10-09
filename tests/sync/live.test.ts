import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: { payload?: Record<string, unknown> }) => void;

class FakeChannel {
  handlers = new Map<string, Handler>();
  constructor(
    readonly topic: string,
    readonly options: unknown,
  ) {}
  on(type: string, filter: { event: string }, handler: Handler) {
    this.handlers.set(`${type}:${filter.event}`, handler);
    return this;
  }
  subscribe() {
    return this;
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

const { followLists, startLive, stopLive } = await import("../../src/sync/live");

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
  it("joins each shared list's private channel with the project's key and their token", async () => {
    followLists(["a", "b"]);
    await start();
    expect(client().endpoint).toBe("https://x.supabase.co/realtime/v1");
    expect(client().options.params.apikey).toBe("anon");
    expect(await client().options.accessToken()).toBe("jwt");
    expect(client().channels.map((c) => c.topic)).toEqual([`user:${ME}`, "list:a", "list:b"]);
    expect(channelOf("a").options).toEqual({ config: { private: true } });
  });

  it("follows the lists as they change: a new one joined, one left dropped, one kept not joined twice", async () => {
    await start();
    followLists(["a", "b"]);
    followLists(["b", "c"]);
    expect(client().channels.map((c) => c.topic)).toEqual([`user:${ME}`, "list:a", "list:b", "list:c"]);
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

  it("pulls when the person's place in a list changed, told on their own channel, by whichever of their devices", async () => {
    await start();
    const own = client().channels.find((c) => c.topic === `user:${ME}`)!;
    expect(own.options).toEqual({ config: { private: true } });
    own.emit("broadcast:moved", { by: HER, list: "a" });
    own.emit("broadcast:moved", { by: ME, list: "a" });
    expect(onMoved).toHaveBeenCalledTimes(2);
  });

  it("ends everything on sign-out, and a start overtaken by it opens nothing", async () => {
    followLists(["a"]);
    await start();
    const first = client();
    const late = start();
    stopLive();
    await late;
    await Promise.resolve();
    expect(first.disconnected).toBe(true);
    expect(clients).toHaveLength(1);
    followLists(["b"]);
    expect(first.channels).toHaveLength(2);
  });

  it("starts again cleanly, following what it was told before", async () => {
    await start();
    followLists(["a"]);
    await start();
    expect(clients[0]!.disconnected).toBe(true);
    expect(client().channels.map((c) => c.topic)).toEqual([`user:${ME}`, "list:a"]);
  });

  it("lets a refusal on the way pass quietly: the half-minute pull still comes", async () => {
    followLists(["a", "b"]);
    await start();
    client().removeChannel.mockRejectedValueOnce(new Error("offline"));
    client().disconnect.mockRejectedValueOnce(new Error("offline"));
    followLists(["b"]);
    stopLive();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
