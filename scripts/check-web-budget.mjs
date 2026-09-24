#!/usr/bin/env node
/**
 * Fail when the web export outgrows its recorded weight.
 *
 * Metro does not tree-shake, so one convenient import from a package root can
 * put a whole library in the entry bundle without a single line of app code
 * changing: Helix measured an icon barrel at 34.7% of its entry bundle. A
 * ceiling is the only thing that says so at the commit that did it.
 *
 * Each ceiling is a measurement plus about 1% of slack, and moving one is a
 * decision recorded in `docs/HEALTH.md` with the before and after figures —
 * never an edit made to get a push through. Lower them when a change makes the
 * export lighter, or the weight can come back unnoticed.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Measured 2026-09-24 on the quick-add suggestions: entry 1_575_486, all JS
// 1_708_156, export 3_242_820. `docs/HEALTH.md` traces the growth.
const CEILINGS = {
  entryJs: 1_592_000,
  totalJs: 1_726_000,
  totalExport: 3_276_000,
};

const root = process.argv[2] ?? "dist";

const files = (readdirSync(root, { recursive: true })).map((name) => join(root, String(name)))
  .filter((path) => statSync(path).isFile())
  .map((path) => ({ path: relative(root, path), bytes: statSync(path).size }));

if (files.length === 0) {
  console.error(`${root} is empty. Run \`npm run web:export\` first.`);
  process.exit(1);
}

const js = files.filter((f) => f.path.endsWith(".js"));
const entries = js.filter((f) => /(^|\/)entry-[^/]*\.js$/.test(f.path));
if (entries.length !== 1) {
  console.error(`Expected one entry bundle, found ${entries.length}: ${entries.map((f) => f.path).join(", ")}`);
  process.exit(1);
}

const sum = (list) => list.reduce((total, f) => total + f.bytes, 0);
const measured = { entryJs: entries[0].bytes, totalJs: sum(js), totalExport: sum(files) };

let failed = false;
for (const [name, ceiling] of Object.entries(CEILINGS)) {
  const value = measured[name];
  const over = value > ceiling;
  failed ||= over;
  console.log(`${over ? "OVER" : "  ok"}  ${name.padEnd(12)} ${String(value).padStart(10)} / ${ceiling}`);
}
if (failed) {
  console.error("\nThe export outgrew its budget. Find the import that did it before moving a ceiling.");
  process.exit(1);
}
