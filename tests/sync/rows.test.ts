import { describe, expect, it } from "vitest";

import { toLocalRow, toServerRow } from "../../src/sync/rows";

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

  it("leaves out a column an event from before it existed does not carry, so the server keeps what it holds", () => {
    const { pantry: _, ...old } = { id: ID, created_at: STAMP, updated_at: STAMP, deleted_at: null, tombstone_version: 0, name: "Market", color: null, icon: null, kind: "shop", pantry: 1 };
    expect(toServerRow("lists", old, USER)).toEqual(old);
    const { name: __, ...nameless } = old;
    expect(toServerRow("lists", nameless, USER), "but not one the server has no value for").toBeNull();
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
