/** The price watch's decisions (SPEC 7.5): when to look again, and which price rings. */

import { describe, expect, it } from "vitest";

import { isWatchDue, keyOf, pricesRead, readWatchState, WATCH_EVERY_MS } from "../../src/domain/price-watch";

const link = (id: string, priceMinor: number) => ({ id, url: `https://a.com/${id}`, priceMinor, wishName: `İstek ${id}` });

describe("readWatchState", () => {
  it("reads what this phone stored, and starts afresh from anything else", () => {
    expect(readWatchState(JSON.stringify({ at: 5, seen: { a: 100, b: -1, c: 1.5, d: "9", e: 0 } }))).toEqual({ at: 5, seen: { a: 100 } });
    expect(readWatchState(JSON.stringify({ at: "x" }))).toEqual({ at: 0, seen: {} });
    expect(readWatchState(null)).toEqual({ at: 0, seen: {} });
    expect(readWatchState("{")).toEqual({ at: 0, seen: {} });
  });
});

describe("isWatchDue", () => {
  it("looks again once the interval has passed", () => {
    const sixHours = 6 * 60 * 60 * 1000;
    expect(WATCH_EVERY_MS).toBe(sixHours);
    expect(isWatchDue({ at: 0, seen: {} }, sixHours)).toBe(true);
    expect(isWatchDue({ at: 1, seen: {} }, sixHours)).toBe(false);
  });
});

describe("pricesRead", () => {
  it("rings a price below the lowest seen, once, and forgets links no longer watched", () => {
    // uuidv7 ids saved in the same minute share their first characters: each still keeps its own lowest.
    const [a, b, c] = ["019a1b2c-0000-7000-8000-00000000000a", "019a1b2c-0000-7000-8000-00000000000b", "019a1b2c-0000-7000-8000-00000000000c"];
    const links = [link(a, 100000), link(b, 50000), link(c, 20000)];
    const before = { at: 0, seen: { [keyOf(b)]: 45000, gone: 1 } };
    const read = new Map<string, number | null>([
      [a, 90000],
      [b, 47000],
      [c, null],
    ]);
    const first = pricesRead(links, read, before, 7);
    expect(first.drops).toEqual([{ wishName: `İstek ${a}`, url: `https://a.com/${a}`, fromMinor: 100000, toMinor: 90000 }]);
    expect(first.state).toEqual({ at: 7, seen: { "0000000a": 90000, "0000000b": 45000, "0000000c": 20000 } });
    expect(pricesRead(links, read, first.state, 8).drops).toEqual([]);
  });

  it("lets a fall under one per cent pass, and starts from a price the owner lowered by hand", () => {
    expect(pricesRead([link("a", 100000)], new Map([["a", 99500]]), { at: 0, seen: {} }, 1).drops).toEqual([]);
    expect(pricesRead([link("a", 100000)], new Map([["a", 99000]]), { at: 0, seen: {} }, 1).drops, "exactly one per cent is not yet").toEqual([]);
    expect(pricesRead([link("a", 80000)], new Map([["a", 79500]]), { at: 0, seen: { a: 90000 } }, 1).state.seen).toEqual({ a: 80000 });
  });
});
