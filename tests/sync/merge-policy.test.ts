/**
 * Sync's pure rules, Helix's tests adapted: which outbox event is sent, when a
 * pulled row wins, when a table may be skipped, what a failed refresh means,
 * and that a late answer cannot reach the next account.
 */

import { describe, expect, it } from "vitest";
import {
  classifyOutboxBatch,
  cursorIsAtServerHead,
  formatPullCursor,
  isAddedAgain,
  isUuidShaped,
  parsePullCursor,
  PULL_EPOCH,
  remoteWinsLww,
  shouldApplyServerAck,
} from "../../src/sync/merge-policy";
import { toLocalRow, toServerRow } from "../../src/sync/rows";
import { SessionEpoch, SessionEpochCancelledError } from "../../src/sync/session-epoch";
import { classifyRefreshFailure, completedSyncState } from "../../src/sync/status";

describe("the outbox batch", () => {
  it("sends the newest event per row, and never an older one behind a corrupt newer one", () => {
    const result = classifyOutboxBatch([
      { id: 1, row_id: "a", payload: JSON.stringify({ id: "a", value: 1 }) },
      { id: 2, row_id: "a", payload: JSON.stringify({ id: "a", value: 2 }) },
      { id: 3, row_id: "a", payload: "{" },
      { id: 4, row_id: "c", payload: JSON.stringify({ id: "other" }) },
      { id: 5, row_id: "d", payload: JSON.stringify({ id: "d", value: 1 }) },
      { id: 6, row_id: "d", payload: JSON.stringify({ id: "d", value: 2 }) },
      { id: 7, row_id: "e", payload: "[]" },
    ]);
    expect(result.latestByRow.has("a")).toBe(false);
    expect(result.latestByRow.get("d")?.row.value).toBe(2);
    expect(result.rejected.map((event) => [event.id, event.reason])).toEqual([
      [3, "malformed_payload"],
      [4, "malformed_payload"],
      [7, "malformed_payload"],
    ]);
  });

  it("does not apply an acknowledgement over a local edit queued meanwhile", () => {
    expect(shouldApplyServerAck(8, 9)).toBe(false);
    expect(shouldApplyServerAck(8, 8)).toBe(true);
    expect(shouldApplyServerAck(8, null)).toBe(true);
  });

  it("reports a finished sync with refused records as needing attention", () => {
    expect(completedSyncState(0)).toBe("idle");
    expect(completedSyncState(1)).toBe("attention");
  });
});

describe("last writer wins", () => {
  const stamp = "2026-09-27T10:00:00.000Z";

  it("converges on an equal timestamp, and lets a valid one repair a corrupt local clock", () => {
    expect(remoteWinsLww(stamp, stamp)).toBe(true);
    expect(remoteWinsLww("not-a-date", stamp)).toBe(true);
    expect(remoteWinsLww(null, stamp)).toBe(true);
    expect(remoteWinsLww("2099-01-01T00:00:00.000Z", stamp)).toBe(false);
    expect(remoteWinsLww(stamp, "not-a-date")).toBe(false);
  });

  it("lets a delete generation outrank any clock", () => {
    expect(remoteWinsLww(stamp, "2099-01-01T00:00:00.000Z", 2, 1)).toBe(false);
    expect(remoteWinsLww("2099-01-01T00:00:00.000Z", stamp, 1, 2)).toBe(true);
  });

  it("adds a row made afresh over a delete it never saw again, and lets an edit go with the delete", () => {
    const deleted = { deleted_at: stamp, tombstone_version: 1, created_at: "2026-09-27T09:00:00.000000+00:00" };
    const made = { deleted_at: null, tombstone_version: 0, created_at: "2026-09-27T09:30:00.000Z" };
    expect(isAddedAgain(made, deleted)).toBe(true);
    expect(isAddedAgain({ ...made, created_at: "2026-09-27T09:00:00.000Z" }, deleted), "the same moment, written two ways").toBe(false);
    expect(isAddedAgain(made, { ...deleted, deleted_at: null }), "the server kept it").toBe(false);
    expect(isAddedAgain(made, { ...deleted, tombstone_version: 0 }), "no newer generation").toBe(false);
    expect(isAddedAgain({ ...made, deleted_at: stamp }, deleted), "a delete sent is no add").toBe(false);
  });

  it("takes only UUID-shaped ids into a filter or a path", () => {
    expect(isUuidShaped("019f6bba-2c65-7ea8-a6c9-96d891155e83")).toBe(true);
    expect(isUuidShaped("a1b2c3d4-e5f6-8a7b-8c9d-0e1f2a3b4c5d")).toBe(true);
    expect(isUuidShaped("x),list_id.eq.attacker")).toBe(false);
    expect(isUuidShaped("../019f6bba-2c65-7ea8-a6c9-96d891155e83")).toBe(false);
    expect(isUuidShaped(42)).toBe(false);
  });
});

describe("the pull cursor", () => {
  const HEAD = { ts: "2026-09-02T10:00:00.000Z", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

  it("round-trips, and reads a missing or legacy cursor as having no id", () => {
    expect(parsePullCursor(formatPullCursor(HEAD))).toEqual(HEAD);
    expect(parsePullCursor("2026-09-02T10:00:00.000Z")).toEqual({ ts: "2026-09-02T10:00:00.000Z", id: "" });
    expect(parsePullCursor(null)).toEqual({ ts: PULL_EPOCH, id: "" });
  });

  it("skips a table only when the cursor stands on its newest row, or it has none", () => {
    expect(cursorIsAtServerHead(HEAD, HEAD)).toBe(true);
    expect(cursorIsAtServerHead(HEAD, null)).toBe(true);
    expect(cursorIsAtServerHead(HEAD, { ...HEAD, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).toBe(false);
    expect(cursorIsAtServerHead(HEAD, { ...HEAD, ts: "2026-09-02T10:00:01.000Z" })).toBe(false);
    expect(cursorIsAtServerHead(parsePullCursor(null), HEAD)).toBe(false);
    expect(cursorIsAtServerHead(HEAD, { ...HEAD, ts: "not a date" })).toBe(false);
  });
});

describe("a failed refresh", () => {
  it("is the network when Auth could not be reached, and the end of the session when it answered", () => {
    const retryable = new Error("Failed to fetch");
    retryable.name = "AuthRetryableFetchError";
    expect(classifyRefreshFailure(retryable)).toBe("unavailable");
    expect(classifyRefreshFailure(new Error("Gateway Timeout (504)"))).toBe("unavailable");
    expect(classifyRefreshFailure(new Error("Invalid Refresh Token: Already Used"))).toBe("expired");
    expect(classifyRefreshFailure(null)).toBe("expired");
  });
});

describe("the session epoch", () => {
  it("aborts one account's epoch when another account starts", () => {
    const epoch = new SessionEpoch();
    const first = epoch.start("a");
    expect(epoch.activeUserId).toBe("a");
    const next = epoch.start("b");
    expect(first.signal.aborted).toBe(true);
    expect(epoch.isCurrent(next)).toBe(true);
    expect(() => epoch.assertCurrent(first)).toThrow(SessionEpochCancelledError);
  });

  it("does not let a late callback reactivate a stopped session", () => {
    const epoch = new SessionEpoch();
    const token = epoch.start("a");
    epoch.stop();
    expect(token.signal.aborted).toBe(true);
    expect(epoch.capture("a")).toBeNull();
    expect(epoch.isCurrent(token)).toBe(false);
  });
});

describe("a row crossing to the server and back", () => {
  const USER = "11111111-1111-4111-8111-111111111111";
  const ID = "019f6bba-2c65-7ea8-a6c9-96d891155e83";
  const LIST = "019f6bba-2c65-7ea8-a6c9-96d891155e84";
  const STAMP = "2026-09-27T10:00:00.123Z";
  const item = {
    id: ID, created_at: STAMP, updated_at: STAMP, deleted_at: null, tombstone_version: 0,
    list_id: LIST, name: "süt", quantity_milli: 1500, unit: "lt", sort_order: -1, checked_at: null,
    note: null, urgent: 1, not_found: 0, bought_instead: null, price_minor: null, shop_id: null, photo_id: null,
  };

  it("sends a list's row as it is, its booleans as booleans", () => {
    expect(toServerRow("items", item, USER)).toEqual({ ...item, urgent: true, not_found: false });
  });

  it("puts the person into a personal row's key", () => {
    const product = { id: ID, created_at: STAMP, updated_at: STAMP, deleted_at: null, tombstone_version: 0, name: "süt", starred: 1, aisle: null };
    expect(toServerRow("products", product, USER)).toEqual({ ...product, starred: true, user_id: USER });
  });

  it("gives a column an event from before it existed its default", () => {
    const { pantry: _, ...old } = { id: ID, created_at: STAMP, updated_at: STAMP, deleted_at: null, tombstone_version: 0, name: "Market", color: null, icon: null, kind: "shop", pantry: 1 };
    expect(toServerRow("lists", old, USER)).toMatchObject({ pantry: true });
  });

  it("refuses what the schema could not have written", () => {
    expect(toServerRow("items", { ...item, owner: "x" }, USER)).toBeNull();
    expect(toServerRow("items", { ...item, id: "süt" }, USER)).toBeNull();
    expect(toServerRow("items", { ...item, name: null }, USER)).toBeNull();
    expect(toServerRow("items", { ...item, quantity_milli: 1.5 }, USER)).toBeNull();
    expect(toServerRow("items", { ...item, urgent: 2 }, USER)).toBeNull();
    expect(toServerRow("items", { ...item, note: 7 }, USER)).toBeNull();
    expect(toServerRow("items", { ...item, tombstone_version: -1 }, USER)).toBeNull();
  });

  it("stores a server row in the device's shape, and drops what the device has no column for", () => {
    const remote = { ...item, owner_id: USER, urgent: true, not_found: false, updated_at: "2026-09-27T10:00:00.123456+00:00", checked_at: "2026-09-27T09:00:00+00:00" };
    expect(toLocalRow("items", remote, USER)).toEqual({ ...item, updated_at: STAMP, checked_at: "2026-09-27T09:00:00.000Z" });
  });

  it("refuses a server row that is not this person's, or not well formed", () => {
    const product = { user_id: USER, id: ID, created_at: STAMP, updated_at: STAMP, deleted_at: null, tombstone_version: 0, name: "süt", starred: false, aisle: null };
    expect(toLocalRow("products", product, USER)).toMatchObject({ starred: 0 });
    expect(() => toLocalRow("products", { ...product, user_id: "22222222-2222-4222-8222-222222222222" }, USER)).toThrow();
    expect(() => toLocalRow("items", { ...item, id: "x),list_id.eq.y" }, USER)).toThrow();
    expect(() => toLocalRow("items", { ...item, updated_at: "not a date" }, USER)).toThrow();
    expect(() => toLocalRow("items", { ...item, checked_at: "not a date" }, USER)).toThrow();
    expect(() => toLocalRow("items", { ...item, tombstone_version: "1" }, USER)).toThrow();
    expect(() => toLocalRow("items", { ...item, urgent: "yes" }, USER)).toThrow();
    expect(() => toLocalRow("items", { ...item, name: null }, USER)).toThrow();
  });
});
