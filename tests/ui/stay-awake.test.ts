/**
 * A phone running Gital keeps its screen on (SPEC 3.3), on every screen and
 * only while Ayarlar allows it; the web holds nothing and shows no switch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const keepAwake = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(async (_tag: string) => {}),
  deactivateKeepAwake: vi.fn(async (_tag: string) => {}),
}));
vi.mock("expo-keep-awake", () => keepAwake);
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const stored = vi.hoisted(() => new Map<string, string>([["gital.stayAwake", "false"]]));
vi.mock("../../src/services/kv", () => ({
  kv: { get: async (key: string) => stored.get(key) ?? null, set: async (key: string, value: string) => void stored.set(key, value) },
}));

import { setStayAwakeAllowed, stayAwake, stayAwakeAvailable, useStayAwakeAllowed } from "../../src/ui/stay-awake";

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("stayAwake", () => {
  beforeEach(() => {
    keepAwake.activateKeepAwakeAsync.mockClear();
    keepAwake.deactivateKeepAwake.mockClear();
  });

  it("holds the screen until let go, under one tag", async () => {
    expect(stayAwakeAvailable, "a phone").toBe(true);
    const release = stayAwake();
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith(keepAwake.activateKeepAwakeAsync.mock.calls[0]![0]);
  });

  // With no activity to hold, Android refuses both, and the release of a hold never taken throws.
  it("lets neither a refused hold nor its release escape as an error", async () => {
    keepAwake.activateKeepAwakeAsync.mockRejectedValueOnce(new Error("ERR_KEEP_AWAKE_NO_ACTIVITY"));
    keepAwake.deactivateKeepAwake.mockRejectedValueOnce(new Error("ERR_KEEP_AWAKE_TAG_INVALID"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const release = stayAwake();
    release();
    await settle();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("is not offered on the web", async () => {
    vi.resetModules();
    vi.doMock("react-native", () => ({ Platform: { OS: "web" } }));
    expect((await import("../../src/ui/stay-awake")).stayAwakeAvailable).toBe(false);
    vi.doUnmock("react-native");
  });
});

// Ayarlar's switch (the owner asked 2026-09-27): kept on the device, read back
// on the next start, and changed at once for every screen holding the hook.
describe("the stay-awake setting", () => {
  it("reads a switch turned off on an earlier start, and keeps a new choice", async () => {
    await settle();
    const { createElement } = await import("react");
    // react-dom ships no types here, and one call does not earn @types/react-dom.
    const { renderToString } = (await import("react-dom/server" as string)) as { renderToString: (element: unknown) => string };
    const Probe = () => String(useStayAwakeAllowed());
    expect(renderToString(createElement(Probe))).toBe("false");
    setStayAwakeAllowed(true);
    expect(renderToString(createElement(Probe))).toBe("true");
    expect(stored.get("gital.stayAwake")).toBe("true");
  });
});
