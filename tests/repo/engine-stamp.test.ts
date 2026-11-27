import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `src/engine` is written by gital-fiyat's `npm run release:gital` and gated there; lint, coverage and mutation
// skip it here. This is what stops a change made in gital, which the next release would overwrite.
const engine = join(import.meta.dirname, "../../src/engine");

describe("the engine from gital-fiyat", () => {
  it("is what its release wrote", () => {
    const stamp = JSON.parse(readFileSync(join(engine, "STAMP.json"), "utf8")) as { files: Record<string, string> };
    expect(Object.keys(stamp.files).length).toBeGreaterThan(0);
    for (const [rel, hash] of Object.entries(stamp.files)) {
      expect(createHash("sha256").update(readFileSync(join(engine, rel))).digest("hex"), rel).toBe(hash);
    }
  });
});
