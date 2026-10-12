import { describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => new Map<string, string>());

// The pure rules never reach the server; the client is mocked only to keep react-native out.
vi.mock("../../src/sync/supabase", () => ({ getSupabase: () => null }));
vi.mock("../../src/services/kv", () => ({
  kv: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => void kv.set(key, value),
    remove: async (key: string) => void kv.delete(key),
  },
}));

const { heldInvite, holdInvite, inviteFromPage, inviteLink, inviteTokenFrom } = await import("../../src/sync/sharing");

describe("an invitation's link", () => {
  it("reads a link, or its bare token, and nothing else", () => {
    const token = "a".repeat(64);
    expect(inviteTokenFrom(` ${inviteLink(token)} `)).toBe(token);
    expect(inviteTokenFrom(token)).toBe(token);
    expect(inviteTokenFrom("https://example.com/gital/invite#" + token)).toBeNull();
    expect(inviteTokenFrom("a".repeat(63))).toBeNull();
  });

  it("keeps the token a web invitation opened with, and only on its page", () => {
    const token = "b".repeat(64);
    expect(inviteFromPage({ pathname: "/gital/invite", hash: `#${token}` })).toBe(token);
    expect(inviteFromPage({ pathname: "/gital/invite/", hash: `#${token}` })).toBe(token);
    expect(inviteFromPage({ pathname: "/gital/", hash: `#${token}` })).toBeNull();
    expect(inviteFromPage({ pathname: "/gital/invite", hash: "#nope" })).toBeNull();
    expect(inviteFromPage(undefined)).toBeNull();
  });
  it("holds a web invitation for the first sign-in, through a reload, for the link's own seven days", async () => {
    const token = "c".repeat(64);
    const stored = (at: number) => kv.set("gital.invite", JSON.stringify({ token, at }));
    await holdInvite(token);
    expect(await heldInvite(), "the sign-in screen only looks").toBe(token);
    expect(await heldInvite({ take: true })).toBe(token);
    expect(await heldInvite(), "the next account on this browser is not sent into it").toBeNull();
    stored(Date.now());
    expect(await heldInvite(), "a reload, or the confirmation's tab, finds it").toBe(token);
    stored(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(await heldInvite()).toBeNull();
    kv.set("gital.invite", "{");
    expect(await heldInvite()).toBeNull();
  });
});
