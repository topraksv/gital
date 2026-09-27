/**
 * An invitation as a QR code (SPEC 1.4), drawn as one SVG path: a row's
 * neighbouring dark cells are one rectangle, so a link's ~1,100 cells cost a
 * few hundred commands rather than a view each.
 */

import { encode } from "uqr";

/** The four-cell light margin a scanner needs around the code. */
const QUIET = 4;

export function qrPath(text: string): { size: number; path: string } {
  const { data } = encode(text, { border: 0, ecc: "M" });
  let path = "";
  data.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (row[x + run]) run++;
      path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run - 1;
    }
  });
  return { size: data.length + 2 * QUIET, path };
}
