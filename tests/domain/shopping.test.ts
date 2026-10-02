/** Who is shopping a list, read from ticks (SPEC 1.6). */

import { describe, expect, it } from "vitest";

import { announce, nextExpiry, shoppersNow, SHOPPING_WINDOW_MS, type Tick } from "../../src/domain/shopping";

const ME = "me";
const HER = "her";
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + minutes * 60_000).toISOString();
const tick = (by: string, minutes: number, listId = "a"): Tick => ({ listId, by, at: at(minutes) });
const NOW = Date.parse(at(0));

describe("shoppersNow", () => {
  it("keeps a tick up to a second short of fifteen minutes, and drops it at fifteen", () => {
    expect(shoppersNow([tick(HER, -14.983)], ME, NOW)).toHaveLength(1);
    expect(shoppersNow([tick(HER, -15)], ME, NOW)).toEqual([]);
    expect(SHOPPING_WINDOW_MS).toBe(15 * 60_000);
  });

  it("leaves the person out, and ticks without a person or a readable time", () => {
    expect(shoppersNow([tick(ME, -1), { listId: "a", by: "", at: at(-1) }, { listId: "a", by: HER, at: "soon" }], ME, NOW)).toEqual([]);
  });

  it("names each person once per list, expiring fifteen minutes after the last tick", () => {
    const found = shoppersNow([tick(HER, -10), tick(HER, -2), tick(HER, -5, "b")], ME, NOW);
    expect(found).toEqual([
      { listId: "a", by: HER, expiresAt: NOW + 13 * 60_000 },
      { listId: "b", by: HER, expiresAt: NOW + 10 * 60_000 },
    ]);
  });

  it("keeps the latest tick whatever order the rows come in", () => {
    expect(shoppersNow([tick(HER, -2), tick(HER, -10)], ME, NOW)).toEqual([{ listId: "a", by: HER, expiresAt: NOW + 13 * 60_000 }]);
  });

  it("orders by list, then by person, not by the rows' order", () => {
    const found = shoppersNow([tick("zeki", -1, "b"), tick(HER, -1, "b"), tick("zeki", -1, "a")], ME, NOW);
    expect(found.map((shopper) => `${shopper.listId}:${shopper.by}`)).toEqual(["a:zeki", "b:her", "b:zeki"]);
  });

  it("is empty once the ticks are gone: a shop finished or a tick taken back", () => {
    expect(shoppersNow([], ME, NOW)).toEqual([]);
  });
});

describe("nextExpiry", () => {
  it("is the earliest, and null when nobody is shopping", () => {
    expect(nextExpiry([])).toBeNull();
    expect(nextExpiry(shoppersNow([tick(HER, -10), tick("him", -1)], ME, NOW))).toBe(NOW + 5 * 60_000);
  });
});

describe("announce", () => {
  const her = { listId: "a", by: HER, expiresAt: NOW + 1 };

  it("says a run once, however often it is read again", () => {
    const first = announce([her], new Set());
    expect(first.fresh).toEqual([her]);
    expect(announce([her], first.announced).fresh).toEqual([]);
  });

  it("says a new run after the last one lapsed", () => {
    const lapsed = announce([her], announce([her], new Set()).announced);
    const gone = announce([], lapsed.announced);
    expect(announce([her], gone.announced).fresh).toEqual([her]);
  });

  it("tells a list apart from another, and a person from another", () => {
    const first = announce([her], new Set()).announced;
    const more = [her, { ...her, listId: "b" }, { ...her, by: "him" }];
    expect(announce(more, first).fresh).toEqual(more.slice(1));
  });
});
