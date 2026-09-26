/**
 * A list's screen keeps the phone awake while there is something to buy
 * (SPEC 3.3). The web's wake lock is the browser's, which lets it go whenever
 * the page is hidden and never takes it back itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keepAwake = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(async (_tag: string) => {}),
  deactivateKeepAwake: vi.fn(async (_tag: string) => {}),
}));
vi.mock("expo-keep-awake", () => keepAwake);

import { stayAwake } from "../../src/ui/stay-awake";

class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  show(state: "visible" | "hidden") {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("stayAwake", () => {
  let page: FakeDocument;
  beforeEach(() => {
    page = new FakeDocument();
    vi.stubGlobal("document", page);
    keepAwake.activateKeepAwakeAsync.mockClear();
    keepAwake.deactivateKeepAwake.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("holds the screen until let go, under one tag", async () => {
    const release = stayAwake();
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith(keepAwake.activateKeepAwakeAsync.mock.calls[0]![0]);
  });

  it("takes the lock again when the page comes back into view, and stops asking once let go", () => {
    const release = stayAwake();
    page.show("hidden");
    page.show("visible");
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
    release();
    page.show("hidden");
    page.show("visible");
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
  });

  // A browser without the Wake Lock API, or a page hidden when it asked,
  // refuses; letting go of a lock never taken then throws in expo-keep-awake.
  it("lets neither a refused lock nor its release escape as an error", async () => {
    keepAwake.activateKeepAwakeAsync.mockRejectedValueOnce(new Error("NotAllowedError"));
    keepAwake.deactivateKeepAwake.mockRejectedValueOnce(new Error("ERR_KEEP_AWAKE_TAG_INVALID"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const release = stayAwake();
    release();
    await settle();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("works where there is no page to watch, as on a phone", () => {
    vi.stubGlobal("document", undefined);
    const release = stayAwake();
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(release).not.toThrow();
  });
});
