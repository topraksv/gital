/**
 * Overlapping prompts must never drop a request: Helix's test for the reducer
 * both overlay hosts share (`src/ui/request-queue.ts`).
 */

import { describe, expect, it } from "vitest";

import {
  advanceRequestQueue,
  closeRequest,
  emptyRequestQueue,
  enqueueRequest,
  type RequestQueue,
} from "../../src/ui/request-queue";

interface Request<T> {
  id: string;
  resolve: (value: T) => void;
}

/** A store shaped like zustand's, driven the way both hosts drive theirs. */
function createQueue<T>() {
  let state: RequestQueue<Request<T>> = emptyRequestQueue<Request<T>>();
  const store = { getState: () => state, setState: (next: RequestQueue<Request<T>>) => (state = next) };
  return {
    get state() {
      return state;
    },
    enqueue(request: Request<T>) {
      state = enqueueRequest(state, request);
    },
    /** Closes the open request, or the one named: a stale control names its own. */
    close(value: T, request = state.current) {
      if (request) closeRequest(store, request, (closed) => closed.resolve(value));
    },
  };
}

describe("prompt queue", () => {
  it("shows one at a time and settles each in order", () => {
    const settled: string[] = [];
    const q = createQueue<string | null>();
    q.enqueue({ id: "a", resolve: (v) => settled.push(`a:${v}`) });
    q.enqueue({ id: "b", resolve: (v) => settled.push(`b:${v}`) });
    expect(q.state.current?.id).toBe("a");
    expect(q.state.queue).toHaveLength(1);

    q.close("first");
    expect(settled).toEqual(["a:first"]);
    expect(q.state.current?.id).toBe("b");

    q.close("second");
    expect(settled).toEqual(["a:first", "b:second"]);
    expect(q.state.current).toBeNull();
  });

  it("NEVER leaves a promise unsettled when prompts overlap", () => {
    // The regression: overwriting `current` dropped the first resolve.
    const settled: string[] = [];
    const q = createQueue<string | null>();
    for (const id of ["a", "b", "c"]) q.enqueue({ id, resolve: () => settled.push(id) });
    q.close(null);
    q.close(null);
    q.close(null);
    expect(settled).toEqual(["a", "b", "c"]);
  });

  it("settles a dismissal with null and still advances", () => {
    const settled: (string | null)[] = [];
    const q = createQueue<string | null>();
    q.enqueue({ id: "a", resolve: (v) => settled.push(v) });
    q.enqueue({ id: "b", resolve: (v) => settled.push(v) });
    q.close(null);
    expect(settled).toEqual([null]);
    expect(q.state.current?.id).toBe("b");
  });

  it("ignores a second close from a request already closed, leaving the next one open", () => {
    // A double tap reaches the old control before the host has re-rendered.
    const settled: string[] = [];
    const q = createQueue<string | null>();
    q.enqueue({ id: "a", resolve: (v) => settled.push(`a:${v}`) });
    q.enqueue({ id: "b", resolve: (v) => settled.push(`b:${v}`) });
    const first = q.state.current!;
    q.close("Market", first);
    q.close("Market", first);
    expect(settled).toEqual(["a:Market"]);
    expect(q.state.current?.id).toBe("b");
  });

  it("is idempotent when closed with nothing open", () => {
    const q = createQueue<string | null>();
    q.close(null);
    expect(q.state.current).toBeNull();
    expect(q.state.queue).toEqual([]);
  });

  it("keeps queue order across an unmount-and-reopen cycle", () => {
    const settled: string[] = [];
    const q = createQueue<string | null>();
    q.enqueue({ id: "a", resolve: () => settled.push("a") });
    q.enqueue({ id: "b", resolve: () => settled.push("b") });
    // Host unmounts and remounts: the store outlives it, so `b` is still queued.
    expect(q.state.queue.map((r) => r.id)).toEqual(["b"]);
    q.close(null);
    expect(q.state.current?.id).toBe("b");
    q.close(null);
    expect(settled).toEqual(["a", "b"]);
  });

  it("lets a resolve handler open the next request without losing it", () => {
    // `close` advances BEFORE resolving, so a follow-up prompt opened from the
    // resolve handler enqueues against the advanced state. Advancing after the
    // resolve would overwrite the follow-up with the promoted request.
    const settled: string[] = [];
    const q = createQueue<string | null>();
    q.enqueue({
      id: "a",
      resolve: () => {
        settled.push("a");
        q.enqueue({ id: "follow-up", resolve: () => settled.push("follow-up") });
      },
    });
    q.close(null);
    expect(q.state.current?.id).toBe("follow-up");
    q.close(null);
    expect(settled).toEqual(["a", "follow-up"]);
  });
});

describe("request-queue reducer", () => {
  it("starts empty", () => {
    expect(emptyRequestQueue<string>()).toEqual({ current: null, queue: [] });
  });

  it("does not mutate the state it is given", () => {
    const before: RequestQueue<string> = { current: "a", queue: ["b"] };
    const after = enqueueRequest(before, "c");
    expect(before).toEqual({ current: "a", queue: ["b"] });
    expect(after).toEqual({ current: "a", queue: ["b", "c"] });
    expect(advanceRequestQueue(before)).toEqual({ current: "b", queue: [] });
    expect(before).toEqual({ current: "a", queue: ["b"] });
  });

  it("keeps a queued request behind the open one, never replacing it", () => {
    const state = enqueueRequest(enqueueRequest(emptyRequestQueue<string>(), "a"), "b");
    expect(state.current).toBe("a");
    expect(state.queue).toEqual(["b"]);
  });

  it("empties rather than throwing when advanced past the last request", () => {
    expect(advanceRequestQueue<string>({ current: "a", queue: [] })).toEqual({ current: null, queue: [] });
    expect(advanceRequestQueue<string>({ current: null, queue: [] })).toEqual({ current: null, queue: [] });
  });
});
