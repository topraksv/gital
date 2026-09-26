/**
 * The clipboard's link offered when the app opens (SPEC 2.9): on Android the
 * link itself, once; on iOS, where reading asks the person, only that there
 * is one, at most once a day.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const phone = vi.hoisted(() => ({ os: "android", text: "", hasUrl: false, reads: 0, stored: new Map<string, string>() }));

vi.mock("react-native", () => ({ Platform: { get OS() { return phone.os; } } }));
vi.mock("expo-clipboard", () => ({
  getStringAsync: async () => {
    phone.reads += 1;
    return phone.text;
  },
  hasUrlAsync: async () => phone.hasUrl,
}));
vi.mock("../../src/services/kv", () => ({
  kv: { get: async (key: string) => phone.stored.get(key) ?? null, set: async (key: string, value: string) => void phone.stored.set(key, value) },
}));

const { clipboardOffer } = await import("../../src/services/clipboard-link.native");

beforeEach(() => {
  Object.assign(phone, { os: "android", text: "", hasUrl: false, reads: 0 });
  phone.stored.clear();
});

describe("on Android", () => {
  it("offers a link once, and nothing for text that is not one", async () => {
    phone.text = "  https://www.trendyol.com/kahve-makinesi-p-1 ";
    expect(await clipboardOffer()).toEqual({ url: "https://www.trendyol.com/kahve-makinesi-p-1" });
    expect(await clipboardOffer()).toBeNull();
    phone.text = "süt al";
    expect(await clipboardOffer()).toBeNull();
  });
});

describe("on iOS", () => {
  const T = 1_000_000_000_000;

  it("never reads the clipboard, and offers what is there at most once a day", async () => {
    phone.os = "ios";
    phone.hasUrl = true;
    expect(await clipboardOffer(T)).toEqual({ url: null });
    expect(await clipboardOffer(T + 3_600_000)).toBeNull();
    expect(await clipboardOffer(T + 86_400_000)).toEqual({ url: null });
    phone.hasUrl = false;
    expect(await clipboardOffer(T + 3 * 86_400_000)).toBeNull();
    expect(phone.reads).toBe(0);
  });
});

it("makes a clipboard the phone refuses no offer rather than an error", async () => {
  phone.text = undefined as unknown as string;
  await expect(clipboardOffer()).resolves.toBeNull();
});
