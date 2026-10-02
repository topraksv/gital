/**
 * A `.native` file shares code with its web twin through a third module, never
 * by importing the twin: on a phone `./stem` resolves to the `.native` file
 * itself, so the value read is its own unfinished export. Typecheck, these
 * tests and the browser suite all resolve the web file, so none of them can
 * see it; the phone's photo viewer opened nothing until 2026-10-02.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "..", "..", "src");
const natives = (readdirSync(src, { recursive: true }) as string[]).filter((file) => /\.native\.tsx?$/.test(file));

describe("a platform split", () => {
  it("finds native files to read, so an empty glob cannot pass", () => {
    expect(natives.length).toBeGreaterThan(0);
  });

  it("takes no value from its own stem", () => {
    const offenders = natives.filter((file) => {
      const stem = basename(file).replace(/\.native\.tsx?$/, "");
      // A re-export resolves the same way; `import type` and `export type` are erased before Metro resolves anything.
      return new RegExp(`^(?:import|export) (?!type\\b)[^;]*from ["']\\./${stem}["'];`, "m").test(readFileSync(join(src, file), "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
