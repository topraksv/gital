/**
 * Where a dragged row lands among rows of their own heights
 * (`src/ui/reorder.ts`): past half of a neighbour and the gap it takes that
 * neighbour's place, and it never trades back and forth at the line.
 */

import { describe, expect, it } from "vitest";

import { follow } from "../../src/ui/reorder";

const GAP = 8;

describe("follow", () => {
  it("stays put until the finger is past half of the row below and the gap", () => {
    expect(follow([40, 80, 40], GAP, 0, 0, 44)).toEqual({ at: 0, shift: 0 });
    expect(follow([40, 80, 40], GAP, 0, 0, 45)).toEqual({ at: 1, shift: 88 });
  });

  it("crosses several rows of different heights in one move", () => {
    expect(follow([40, 80, 40], GAP, 0, 0, 120)).toEqual({ at: 2, shift: 136 });
  });

  it("moves up past the row above, and back down only past its half again", () => {
    const up = follow([40, 80, 40], GAP, 2, 0, -70);
    expect(up).toEqual({ at: 1, shift: -88 });
    expect(follow([40, 40, 80], GAP, up.at, up.shift, -60)).toEqual(up);
  });

  it("stops at either end", () => {
    expect(follow([40, 40], GAP, 0, 0, -500)).toEqual({ at: 0, shift: 0 });
    expect(follow([40, 40], GAP, 1, 0, 500)).toEqual({ at: 1, shift: 0 });
  });
});
