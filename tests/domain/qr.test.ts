import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { qrPath } from "../../src/domain/qr";

/** The dark cells a path draws, read back from its runs. */
function cellsOf(path: string): Set<string> {
  const cells = new Set<string>();
  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let at = 0; at < Number(run); at++) cells.add(`${Number(x) + at},${y}`);
  }
  return cells;
}

describe("qrPath", () => {
  const link = `https://topraksv.github.io/gital/invite#${"c".repeat(64)}`;

  it("draws exactly the code's dark cells, inside a quiet zone", () => {
    const { size, path } = qrPath(link);
    const { data } = encode(link, { border: 0, ecc: "M" });
    expect(size).toBe(data.length + 8);
    const expected = new Set<string>();
    data.forEach((row, y) => row.forEach((dark, x) => dark && expected.add(`${x + 4},${y + 4}`)));
    expect(cellsOf(path)).toEqual(expected);
  });

  it("draws a row's neighbouring cells as one run", () => {
    const { path } = qrPath(link);
    // The finder's top edge: seven dark cells, one run.
    expect(path.startsWith("M4 4h7v1h-7z")).toBe(true);
  });
});
